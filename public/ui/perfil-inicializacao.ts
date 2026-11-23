/**
 * Perfil de inicializacao (Fase 8).
 *
 * `?perfil=leve` e opt-in: desliga pose e maos **antes** da carga dos modelos,
 * reduzindo tempo de partida e memoria residente em hardware limitado. A
 * deteccao permanece ligada para nao eliminar a evidencia minima, e o NSFW
 * continua seguindo o toggle da interface.
 *
 * Importante: desligar um subsistema nao e ausencia observada. O pipeline ja
 * registra o subsistema como `desativado` e os frames como `indisponivel` —
 * nunca como "nao havia nada na cena".
 */

import type { HabilitacaoSubsistemas } from "../perception/local-perception-pipeline";

export type PerfilInicializacao = "completo" | "leve";

/** Le o perfil da URL; qualquer valor diferente de `leve` mantem o padrao. */
export function lerPerfilInicializacao(parametros: URLSearchParams): PerfilInicializacao {
  return parametros.get("perfil") === "leve" ? "leve" : "completo";
}

/** Aplica o perfil por cima da habilitacao ja resolvida pela variante/modo. */
export function aplicarPerfilInicializacao(
  habilitacao: HabilitacaoSubsistemas,
  perfil: PerfilInicializacao
): HabilitacaoSubsistemas {
  if (perfil === "completo") return habilitacao;
  return { ...habilitacao, pose: false, maos: false };
}
