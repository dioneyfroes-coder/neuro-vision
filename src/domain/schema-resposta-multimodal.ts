/**
 * Schema canônico e validação da resposta multimodal (Fase 6, itens 4 e 5).
 *
 * Não introduz formato concorrente: valida a forma já usada por
 * `ResultadoInterpretacao`, adicionando campos exigidos pelo plano mestre
 * quando presentes na resposta do modelo. Não depende de biblioteca externa —
 * a validação é pura, determinística e auditável. Referências a IDs reais são
 * tratadas em `validarReferencias` (camada de contexto); aqui apenas se exige
 * que sejam listas de strings.
 */
import { validarCronologiaResposta, type ContextoCronologia } from "./validacao-cronologia";

export const VERSAO_SCHEMA_RESPOSTA = 1;

export interface SchemaRespostaMultimodal {
  versao: number;
  valido: boolean;
  erros: string[];
  /** Campos extras/ausentes que não invalidam a leitura, mas merecem registro. */
  avisos: string[];
}

export interface AnaliseRespostaMultimodal {
  json: Record<string, unknown> | null;
  schema: SchemaRespostaMultimodal;
}

const CAMPOS_CONHECIDOS = new Set([
  "resumo",
  "acoes",
  "participantes",
  "evidencias",
  "incertezas",
  "contradicacoes",
  "contradicoes",
  "modelo",
  "tokens",
]);

const NATUREZAS = new Set(["observada", "inferida"]);
const APRESENTACOES = new Set(["masculina", "feminina", "ambigua", "nao_identificada"]);
const IDENTIDADES = new Set(["homem", "mulher", "pessoa_trans", "nao_informada"]);

function camposDeTexto(obj: Record<string, unknown>, chave: string, erros: string[]): void {
  if (!(chave in obj)) return;
  const valor = obj[chave];
  if (!Array.isArray(valor) || valor.some((item) => typeof item !== "string")) {
    erros.push(`${chave} deve ser uma lista de textos`);
  }
}

function itens(
  obj: Record<string, unknown>,
  chave: string,
  erros: string[]
): Record<string, unknown>[] {
  const valor = obj[chave];
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) {
    erros.push(`${chave} deve ser uma lista`);
    return [];
  }
  return valor.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === "object"
  );
}

/**
 * Valida um objeto já parseado contra o schema canônico.
 * Com `contexto`, acrescenta a checagem semântica de cronologia (Fase 4);
 * sem ele, o comportamento é exatamente o anterior.
 */
export function validarRespostaMultimodal(
  valor: unknown,
  contexto?: ContextoCronologia
): SchemaRespostaMultimodal {
  const schema: SchemaRespostaMultimodal = {
    versao: VERSAO_SCHEMA_RESPOSTA,
    valido: false,
    erros: [],
    avisos: [],
  };
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    schema.erros.push("resposta não é um objeto");
    return schema;
  }
  const obj = valor as Record<string, unknown>;
  if (typeof obj.resumo !== "string" || obj.resumo.trim() === "") {
    schema.erros.push("resumo ausente ou vazio");
  }
  camposDeTexto(obj, "evidencias", schema.erros);
  camposDeTexto(obj, "incertezas", schema.erros);
  camposDeTexto(obj, "contradicacoes", schema.erros);
  camposDeTexto(obj, "contradicoes", schema.erros);

  for (const acao of itens(obj, "acoes", schema.erros)) {
    if (typeof acao.descricao !== "string" || acao.descricao.trim() === "") {
      schema.erros.push("ação sem descrição");
    }
    if (acao.natureza !== undefined) {
      if (typeof acao.natureza !== "string" || !NATUREZAS.has(acao.natureza.trim().toLowerCase())) {
        schema.erros.push("natureza de ação desconhecida");
      }
    }
    if (acao.confianca !== undefined) {
      if (typeof acao.confianca !== "number" || !Number.isFinite(acao.confianca) || acao.confianca < 0 || acao.confianca > 1) {
        schema.erros.push("confiança fora de [0,1]");
      }
    }
    camposDeTexto(acao, "evidencias", schema.erros);
    for (const chave of ["inicioEm", "fimEm"] as const) {
      if (acao[chave] !== undefined) {
        if (typeof acao[chave] !== "string" || !Number.isFinite(Date.parse(acao[chave] as string))) {
          schema.erros.push(`${chave} inválido`);
        }
      }
    }
  }

  for (const participante of itens(obj, "participantes", schema.erros)) {
    if (typeof participante.descricao !== "string" || participante.descricao.trim() === "") {
      schema.erros.push("participante sem descrição");
    }
    if (participante.apresentacao !== undefined) {
      const valor = participante.apresentacao;
      if (typeof valor !== "string" || !APRESENTACOES.has(valor.trim().toLowerCase())) {
        schema.avisos.push("apresentação desconhecida — normalizada para não_identificada");
      }
    }
    if (participante.identidadeDeclarada !== undefined) {
      const valor = participante.identidadeDeclarada;
      if (typeof valor !== "string" || !IDENTIDADES.has(valor.trim().toLowerCase())) {
        schema.avisos.push("identidade declarada desconhecida — descartada");
      }
    }
    camposDeTexto(participante, "evidencias", schema.erros);
  }

  for (const chave of Object.keys(obj)) {
    if (!CAMPOS_CONHECIDOS.has(chave)) schema.avisos.push(`campo extra: ${chave}`);
  }
  if (contexto) {
    const cronologia = validarCronologiaResposta(valor, contexto);
    schema.erros.push(...cronologia.erros);
    schema.avisos.push(...cronologia.avisos, ...cronologia.incertezas.map((i) => `incerteza: ${i}`));
  }
  schema.valido = schema.erros.length === 0;
  return schema;
}

/** Extrai JSON de bloco cercado ou do trecho entre chaves. */
export function extrairJsonResposta(texto: string): string | null {
  const cerca = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca?.[1]) return cerca[1].trim();
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio >= 0 && fim > inicio) return texto.slice(inicio, fim + 1).trim();
  return null;
}

/** Parseia e valida o texto bruto devolvido pelo backend. */
export function analisarRespostaMultimodal(texto: string): AnaliseRespostaMultimodal {
  const extraido = extrairJsonResposta(texto);
  const candidato = extraido ?? texto;
  try {
    const valor: unknown = JSON.parse(candidato);
    const schema = validarRespostaMultimodal(valor);
    return {
      json: schema.valido || (valor !== null && typeof valor === "object" && !Array.isArray(valor))
        ? (valor as Record<string, unknown>)
        : null,
      schema,
    };
  } catch {
    return {
      json: null,
      schema: {
        versao: VERSAO_SCHEMA_RESPOSTA,
        valido: false,
        erros: ["resposta não é JSON válido"],
        avisos: [],
      },
    };
  }
}
