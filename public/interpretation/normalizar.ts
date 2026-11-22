import { analisarRespostaMultimodal } from "../../src/domain/schema-resposta-multimodal";
import type {
  NaturezaAcaoInterpretada,
  ParticipanteInterpretado,
  ResultadoInterpretacao,
  TipoAcaoInterpretada,
} from "../../src/domain/interpretation";

const TIPOS_ACAO = new Set<TipoAcaoInterpretada>([
  "masturbacao",
  "sexo_oral",
  "penetracao",
  "outra",
]);
const NATUREZAS_ACAO = new Set<NaturezaAcaoInterpretada>(["observada", "inferida"]);

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
  const { json: obj, schema } = analisarRespostaMultimodal(bruto);
  try {
    if (obj && typeof obj === "object") {
      const resumo = typeof obj.resumo === "string" ? obj.resumo : "";
      const acoes = Array.isArray(obj.acoes)
        ? obj.acoes
            .filter((a: unknown): a is Record<string, unknown> => a !== null && typeof a === "object")
            .map((a: Record<string, unknown>) => {
              const evidencias = Array.isArray((a as { evidencias?: unknown }).evidencias)
                ? ((a as { evidencias: unknown[] }).evidencias.filter((e): e is string => typeof e === "string"))
                : [];
              const tipoBruto =
                typeof (a as { tipo?: unknown }).tipo === "string"
                  ? (a as { tipo: string }).tipo.trim().toLowerCase()
                  : "";
              const naturezaBruta =
                typeof (a as { natureza?: unknown }).natureza === "string"
                  ? (a as { natureza: string }).natureza.trim().toLowerCase()
                  : "";
              const confiancaBruta = (a as { confianca?: unknown }).confianca;
              const descricao = typeof a.descricao === "string" ? a.descricao : "";
              const inicioEm = typeof a.inicioEm === "string" ? a.inicioEm : undefined;
              const fimEm = typeof a.fimEm === "string" ? a.fimEm : undefined;
              return {
                descricao,
                ...(TIPOS_ACAO.has(tipoBruto as TipoAcaoInterpretada)
                  ? { tipo: tipoBruto as TipoAcaoInterpretada }
                  : {}),
                ...(NATUREZAS_ACAO.has(naturezaBruta as NaturezaAcaoInterpretada)
                  ? { natureza: naturezaBruta as NaturezaAcaoInterpretada }
                  : {}),
                ...(typeof confiancaBruta === "number" && Number.isFinite(confiancaBruta)
                  ? { confianca: Math.min(1, Math.max(0, confiancaBruta)) }
                  : {}),
                ...(inicioEm ? { inicioEm } : {}),
                ...(fimEm ? { fimEm } : {}),
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
      const participantes = normalizarParticipantes(obj.participantes);
      return {
        resumo,
        acoes,
        participantes,
        evidencias,
        incertezas,
        contradicoes,
        modelo,
        schema,
        bruto,
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
    schema,
    bruto,
  };
}

/**
 * Normaliza a lista de participantes descrita pelo modelo.
 *
 * `apresentacao` e leitura visual e cai para `nao_identificada` quando o valor
 * e invalido. `identidadeDeclarada` so e mantida quando explicita e conhecida;
 * qualquer outro valor e descartado (nunca inferimos identidade pela aparencia).
 */
function normalizarParticipantes(valor: unknown): ParticipanteInterpretado[] {
  if (!Array.isArray(valor)) return [];
  const apresentacoes = new Set<ParticipanteInterpretado["apresentacao"]>([
    "masculina",
    "feminina",
    "ambigua",
    "nao_identificada",
  ]);
  const identidades = new Set<
    NonNullable<ParticipanteInterpretado["identidadeDeclarada"]>
  >(["homem", "mulher", "pessoa_trans", "nao_informada"]);
  return valor
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
    .map((p) => {
      const apresentacaoBruta =
        typeof p.apresentacao === "string" ? p.apresentacao.trim().toLowerCase() : "";
      const apresentacao = apresentacoes.has(
        apresentacaoBruta as ParticipanteInterpretado["apresentacao"]
      )
        ? (apresentacaoBruta as ParticipanteInterpretado["apresentacao"])
        : "nao_identificada";
      const identidadeBruta =
        typeof p.identidadeDeclarada === "string"
          ? p.identidadeDeclarada.trim().toLowerCase()
          : "";
      const identidadeDeclarada = identidades.has(
        identidadeBruta as NonNullable<ParticipanteInterpretado["identidadeDeclarada"]>
      )
        ? (identidadeBruta as NonNullable<
            ParticipanteInterpretado["identidadeDeclarada"]
          >)
        : undefined;
      const evidencias = Array.isArray(p.evidencias)
        ? p.evidencias.filter((e): e is string => typeof e === "string")
        : [];
      return {
        descricao: typeof p.descricao === "string" ? p.descricao : "",
        apresentacao,
        ...(identidadeDeclarada ? { identidadeDeclarada } : {}),
        evidencias,
      };
    });
}
