import type { ResultadoInterpretacao } from "../../src/domain/interpretation";

/**
 * Normalizacao da resposta da interpretacao multimodal (Etapa 7 do roteiro).
 *
 * Extrai JSON estruturado (aceita codigo-fenced) e valida o formato. Em caso de
 * falha, retorna `bruto` + `resumo` com o texto bruto, evitando mascarar erros.
 */
export function normalizarInterpretacao(
  texto: string,
  modelo?: string
): ResultadoInterpretacao {
  const bruto = texto ?? "";
  const parseavel = extrairJson(bruto);
  try {
    const obj = parseavel ? JSON.parse(parseavel) : JSON.parse(bruto);
    if (obj && typeof obj === "object") {
      const resumo = typeof obj.resumo === "string" ? obj.resumo : "";
      const acoes = Array.isArray(obj.acoes)
        ? obj.acoes
            .filter((a: unknown): a is Record<string, unknown> => a !== null && typeof a === "object")
            .map((a: Record<string, unknown>) => {
              const evidencias = Array.isArray((a as { evidencias?: unknown }).evidencias)
                ? ((a as { evidencias: unknown[] }).evidencias.filter((e): e is string => typeof e === "string"))
                : [];
              return {
                descricao: typeof (a as { descricao?: unknown }).descricao === "string" ? (a as { descricao?: string }).descricao : "",
                inicioEm: typeof (a as { inicioEm?: unknown }).inicioEm === "string" ? (a as { inicioEm?: string }).inicioEm : undefined,
                fimEm: typeof (a as { fimEm?: unknown }).fimEm === "string" ? (a as { fimEm?: string }).fimEm : undefined,
                evidencias,
              };
            })
        : [];
      const evidencias = Array.isArray(obj.evidencias)
        ? (obj.evidencias as unknown[]).filter((e): e is string => typeof e === "string")
        : [];
      const incertezas = Array.isArray(obj.incertezas)
        ? (obj.incertezas as unknown[]).filter((e): e is string => typeof e === "string")
        : [];
      const contradicoes = Array.isArray(obj.contradicacoes)
        ? (obj.contradicacoes as unknown[]).filter((e): e is string => typeof e === "string")
        : [];
      return {
        resumo,
        acoes,
        evidencias,
        incertezas,
        contradicoes,
        modelo,
        bruto: resumo ? bruto : bruto,
      };
    }
  } catch {
    // Falha na estrutura: devolve bruto para diagnostico.
  }
  return {
    resumo: bruto,
    acoes: [],
    evidencias: [],
    incertezas: ["resposta nao estruturada"],
    contradicoes: [],
    modelo,
    bruto,
  };
}

/** Extrai JSON em bloco ```json ou ``` ou texto entre chaves. */
function extrairJson(texto: string): string | null {
  const fenced = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const prim = texto.indexOf("{");
  const ult = texto.lastIndexOf("}");
  if (prim >= 0 && ult > prim) return texto.slice(prim, ult + 1).trim();
  return null;
}
