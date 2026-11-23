/**
 * Perfis de descricao corporal (Fase 2 do plano NSFW).
 *
 * O perfil **neutro** e independente de `INSTRUCAO_NSFW`: ele nao autoriza
 * descrita explicita, nao force o modelo adulto e nao herda as regras do bloco
 * NSFW. A intencao e separar "descrever corpo/roupa com fidelidade" de
 * "descrever conteudo adulto explicito", como pede o plano (§2.1 e §10.1).
 *
 * Modulo puro: sem SDK, sem `node:*` e sem estado — cliente e servidor montam o
 * mesmo texto. O default continua sendo `sfw`, com o prompt padrao intacto.
 */

import type { QuadroNsfwPrompt } from "./tipos";
import { blocoContextoDeclarado, blocoNsfwPrompt } from "./contexto";
import { formatarMarcacoesNsfw } from "./marcacoes";

/** `sfw` = padrao; `neutro` = anatomia/roupa sem inferencia sexual; `nsfw` = explicito. */
export type PerfilDescricaoCorporal = "sfw" | "neutro" | "nsfw";

/** Perfis aceitos pela API/URL; qualquer outro valor cai no padrao `sfw`. */
export const PERFIS_DESCRICAO_CORPORAL: readonly PerfilDescricaoCorporal[] = [
  "sfw",
  "neutro",
  "nsfw",
];

export function normalizarPerfilDescricaoCorporal(
  valor: unknown
): PerfilDescricaoCorporal | undefined {
  return typeof valor === "string" && (PERFIS_DESCRICAO_CORPORAL as readonly string[]).includes(valor)
    ? (valor as PerfilDescricaoCorporal)
    : undefined;
}

/**
 * Um perfil explicitamente pedido vence o toggle: assim o mesmo conjunto de
 * detectores pode ser comparado com prompt neutro e com prompt explicito. Sem
 * pedido explicito, o comportamento historico e preservado (NSFW ligado =>
 * bloco explicito; desligado => prompt padrao).
 */
export function resolverPerfilDescricaoCorporal(
  perfil: PerfilDescricaoCorporal | undefined | null,
  nsfwAtivo: boolean
): PerfilDescricaoCorporal {
  if (perfil === "neutro" || perfil === "nsfw") return perfil;
  return nsfwAtivo ? "nsfw" : "sfw";
}

/**
 * Instrucao de descricao corporal neutra, escrita do zero e **nao** derivada de
 * `INSTRUCAO_NSFW`. Nao pede termos explicitos, nao proibe recusa por conteudo
 * adulto e nao menciona o classificador: sao politicas diferentes.
 */
export const INSTRUCAO_CORPO_NEUTRO = [
  "DESCRICAO CORPORAL NEUTRA - PERFIL INDEPENDENTE DO NSFW",
  "",
  "Regras:",
  "1. Descreva pessoas adultas com linguagem anatomica neutra: roupa, postura e regioes corporais efetivamente visiveis.",
  "2. Informe o que o frame mostra: torso sem camisa, peitoral e abdomen expostos, roupa aberta/deslocada, regata, roupa de banho, oclusao parcial.",
  "3. Distingua torso exposto, roupa aberta e nudez; nao transforme uma condicao na outra.",
  "4. Nao sexualize pessoa sem camisa ou em roupa de banho. Nao infera excitacao, intencao ou atividade sexual a partir de aparencia, pose ou roupa.",
  "5. Nao resuma torso exposto como pornografia ou ato sexual. Use termos sexuais somente quando o conteudo sexual estiver efetivamente visivel na imagem.",
  "6. Descreva apenas o que a imagem mostra. Se nao houver evidencia, escreva 'nao observado' e registre a duvida como incerteza.",
  "7. Nao determine idade exata pela aparencia. Se houver duvida relevante de menoridade, limite-se a descricao nao sexual e registre a incerteza.",
].join("\n");

/**
 * Bloco neutro. Diferente de `blocoNsfwPrompt`, ele existe mesmo sem marcacoes:
 * o perfil pode ser usado sem detector especializado (comparacao SFW x neutro).
 * Marcacoes, quando presentes, sao evidencia local — a imagem prevalece.
 */
export function blocoCorpoNeutro(
  quadros: ReadonlyArray<QuadroNsfwPrompt>,
  contexto?: string | null
): string {
  const contextoDeclarado = blocoContextoDeclarado(contexto);
  const linhas = quadros.map((q) => {
    const referencia = `Imagem ${q.indice}${q.frameId ? ` (frameId ${q.frameId})` : ""}`;
    return `- ${referencia}: ${formatarMarcacoesNsfw(q.marcacoes)}`;
  });
  return [
    ...(contextoDeclarado ? [contextoDeclarado, ""] : []),
    INSTRUCAO_CORPO_NEUTRO,
    "",
    ...(linhas.length
      ? [
          "Marcacoes locais observadas (evidencia; a imagem prevalece sobre a caixa):",
          ...linhas,
          "",
          "Ausencia de marcacao nao prova ausencia de detalhe corporal; descreva o que o frame mostra.",
        ]
      : ["Sem marcacoes locais neste bloco: use apenas as imagens."]),
  ].join("\n");
}

/** Bloco correspondente ao perfil resolvido; `sfw` nao acrescenta nada. */
export function blocoPerfilCorporal(
  perfil: PerfilDescricaoCorporal,
  quadros: ReadonlyArray<QuadroNsfwPrompt>,
  contexto?: string | null
): string {
  if (perfil === "neutro") return blocoCorpoNeutro(quadros, contexto);
  if (perfil === "nsfw") return blocoNsfwPrompt(quadros, contexto);
  return "";
}
