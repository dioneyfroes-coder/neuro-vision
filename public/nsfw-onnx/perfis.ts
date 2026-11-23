/**
 * Perfis de **execução** dos detectores NSFW (Fase 3 do plano).
 *
 * Não confundir com:
 * - `?perfil=leve` (`ui/perfil-inicializacao.ts`), que desliga pose/mãos na
 *   partida, mas não escolhe modelos NSFW;
 * - `perfilCorporal` (`src/nsfw-prompt/perfil-corporal.ts`), que é semântica de
 *   prompt e não muda quais detectores rodam.
 *
 * O perfil padrão continua `completo`: nenhum comportamento existente muda
 * quando a URL não pede outro. Os perfis oferecem compromissos de custo/cobertura;
 * **não** afirmam precisão antes de validação com dataset anotado.
 */

import { MODELO_NSFW_PADRAO, MODELOS_NSFW_CONJUNTO } from "./catalogo";

export type PerfilModelosNsfw = "leve" | "equilibrado" | "completo";

export const PERFIS_MODELOS_NSFW: readonly PerfilModelosNsfw[] = [
  "leve",
  "equilibrado",
  "completo",
];

export const MODELOS_POR_PERFIL_NSFW: Readonly<
  Record<PerfilModelosNsfw, readonly string[]>
> = {
  leve: [MODELO_NSFW_PADRAO],
  equilibrado: [MODELO_NSFW_PADRAO, "erax_nsfw_yolo11n"],
  completo: MODELOS_NSFW_CONJUNTO,
};

/** Aceita apenas os três valores canônicos; qualquer outro cai no padrão. */
export function normalizarPerfilModelosNsfw(valor: unknown): PerfilModelosNsfw | undefined {
  return typeof valor === "string" && (PERFIS_MODELOS_NSFW as readonly string[]).includes(valor)
    ? (valor as PerfilModelosNsfw)
    : undefined;
}

/** Lista de modelos do perfil; referência imutável do catálogo, sem copiar. */
export function modelosDoPerfilNsfw(perfil: PerfilModelosNsfw = "completo"): readonly string[] {
  return MODELOS_POR_PERFIL_NSFW[perfil];
}
