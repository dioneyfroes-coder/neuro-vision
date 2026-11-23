/**
 * Separação entre detecção anatômica e classificação de ação (Fase 4, plano §8).
 *
 * Uma caixa de quadro inteiro com rótulo `make_love` não é localização
 * anatômica e não confirma o ato: é uma **proposta em nível de cena**. Aqui o
 * rótulo bruto é preservado e recebe metadados estruturais (`tipo`, `escopo`,
 * `origem`, `usoPermitido`). Módulo puro, sem modelo e sem IO.
 *
 * Nenhum destes metadados é afirmação de precisão: a classificação é uma regra
 * determinística sobre o vocabulário conhecido do catálogo.
 */

export type TipoClasseNsfw = "anatomia" | "regiao_corporal" | "estado_visual" | "acao";
export type EscopoClasseNsfw = "local" | "cena";
export type UsoPermitidoNsfw = "localizacao" | "sinal_auxiliar" | "classificacao" | "proposta_temporal";

export interface ClassificacaoClasseNsfw {
  tipo: TipoClasseNsfw;
  escopo: EscopoClasseNsfw;
  usoPermitido: UsoPermitidoNsfw;
  /** Origem da regra aplicada — nunca o nome de um modelo não executado. */
  origem: "vocabulario_catalogo";
  /** `false` para rótulos fora do vocabulário: não inventar anatomia. */
  confiavel: boolean;
}

export interface MarcacaoNsfwClassificada<T = Record<string, unknown>> {
  rotulo: string;
  classificacao: ClassificacaoClasseNsfw;
  marcacao: T;
}

export const ROTULOS_ACAO_NSFW: ReadonlySet<string> = new Set(["make_love"]);

export const ROTULOS_ANATOMIA_NSFW: ReadonlySet<string> = new Set([
  "penis",
  "vagina",
  "anus",
  "nipple",
  "female_genitalia_exposed",
  "female_genitalia_covered",
  "male_genitalia_exposed",
  "male_genitalia_covered",
  "anus_exposed",
  "anus_covered",
  "buttocks_exposed",
  "buttocks_covered",
  "female_breast_exposed",
  "female_breast_covered",
  "male_breast_exposed",
]);

export const ROTULOS_ESTADO_VISUAL_NSFW: ReadonlySet<string> = new Set([
  "breast_exposed",
  "breast_covered",
  "sexually_suggestive",
  "porn",
  "sexy",
]);

/** Texto fixo para o prompt: ação detectada é proposta, nunca confirmação. */
export const INSTRUCAO_PROPOSTA_CENA_NSFW =
  "Marcacoes de acao (como make_love) sao PROPOSTAS DE CENA em nivel de " +
  "cena, nunca confirmacao do ato. So descreva uma acao como observada quando " +
  "a sequencia de frames e a imagem sustentarem a descricao; caso contrario, " +
  "registre a proposta como indice e declare incerteza.";

function chave(rotulo: string): string {
  return rotulo.trim().toLowerCase();
}

/** Classifica um rótulo do catálogo; desconhecidos viram sinal auxiliar. */
export function classificarRotuloNsfw(rotulo: string): ClassificacaoClasseNsfw {
  const normalizado = chave(rotulo);
  if (ROTULOS_ACAO_NSFW.has(normalizado)) {
    return {
      tipo: "acao",
      escopo: "cena",
      usoPermitido: "proposta_temporal",
      origem: "vocabulario_catalogo",
      confiavel: true,
    };
  }
  if (ROTULOS_ANATOMIA_NSFW.has(normalizado)) {
    return {
      tipo: "anatomia",
      escopo: "local",
      usoPermitido: "localizacao",
      origem: "vocabulario_catalogo",
      confiavel: true,
    };
  }
  if (ROTULOS_ESTADO_VISUAL_NSFW.has(normalizado)) {
    return {
      tipo: "estado_visual",
      escopo: "local",
      usoPermitido: "sinal_auxiliar",
      origem: "vocabulario_catalogo",
      confiavel: true,
    };
  }
  return {
    tipo: "regiao_corporal",
    escopo: "local",
    usoPermitido: "sinal_auxiliar",
    origem: "vocabulario_catalogo",
    confiavel: false,
  };
}

/** Anexa metadados sem alterar campos, score ou caixa da marcação original. */
export function classificarMarcacoesNsfw<T extends { rotulo: string }>(
  marcacoes: ReadonlyArray<T>
): Array<MarcacaoNsfwClassificada<T>> {
  return marcacoes.map((marcacao) => ({
    rotulo: marcacao.rotulo,
    classificacao: classificarRotuloNsfw(marcacao.rotulo),
    marcacao,
  }));
}

export function ePropostaCena(
  item: Pick<MarcacaoNsfwClassificada, "classificacao">
): boolean {
  return item.classificacao.tipo === "acao" && item.classificacao.escopo === "cena";
}

export function contemPropostaCena<T extends { rotulo: string }>(
  marcacoes: ReadonlyArray<T>
): boolean {
  return classificarMarcacoesNsfw(marcacoes).some(ePropostaCena);
}
