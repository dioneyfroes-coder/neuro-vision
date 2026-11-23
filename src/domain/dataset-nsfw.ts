/**
 * Contrato de dataset NSFW com separação treino/tuning/teste (Fase 6, plano §16).
 *
 * Módulo puro: valida um **manifesto declarado**, sem ler arquivos, baixar mídia
 * nem executar modelo. A separação é conferida por nome de clipe **e** por
 * SHA-256 declarado — dois arquivos combytes distintos não basta para provar
 * independência. Sem manifesto o relatório é `sem_dados`, nunca "dataset ok".
 */

export type SplitDatasetNsfw = "treino" | "tuning" | "teste";

export const SPLITS_DATASET_NSFW: readonly SplitDatasetNsfw[] = [
  "treino",
  "tuning",
  "teste",
];

/** Campos que indicam mídia/peso incorporado — nunca devem entrar no manifesto. */
const CAMPOS_PROIBIDOS = new Set([
  "imagem", "image", "base64", "video", "audio", "weights", "peso", "bytes",
]);

export interface AnotacaoEntradaDatasetNsfw {
  versaoEsquema?: number;
  conjunto?: string;
  revisao?: { status?: string };
  resolucaoMs?: number;
}

export interface EntradaDatasetNsfw {
  split: SplitDatasetNsfw;
  /** Nome do arquivo de mídia; o arquivo em si fica fora do repositório. */
  clip: string;
  /** SHA-256 declarado do arquivo (64 hex). */
  sha256?: string;
  anotacao?: AnotacaoEntradaDatasetNsfw;
}

export interface RelatorioDatasetNsfw {
  status: "valido" | "invalido" | "sem_dados";
  motivo?: string;
  erros: string[];
  contagem: Record<SplitDatasetNsfw, number>;
  hashesUnicos: number;
  /** `true` somente quando o split de teste tem anotação revisada e esquema v2. */
  prontosParaMetricas: boolean;
}

function vazio(motivo: string): RelatorioDatasetNsfw {
  return {
    status: "sem_dados",
    motivo,
    erros: [],
    contagem: { treino: 0, tuning: 0, teste: 0 },
    hashesUnicos: 0,
    prontosParaMetricas: false,
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Normaliza uma entrada externa; campos proibidos viram erro, não são copiados. */
export function normalizarEntradaDatasetNsfw(valor: unknown): {
  entrada?: EntradaDatasetNsfw;
  erro?: string;
} {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    return { erro: "entrada nao e objeto" };
  }
  const obj = valor as Record<string, unknown>;
  const proibidos = Object.keys(obj)
    .filter((chave) => CAMPOS_PROIBIDOS.has(chave.toLowerCase()))
    .sort();
  if (proibidos.length > 0) return { erro: `campos de midia/peso no manifesto: ${proibidos.join(", ")}` };

  const split = texto(obj.split);
  const clip = texto(obj.clip);
  const sha256 = texto(obj.sha256);
  if (!(SPLITS_DATASET_NSFW as readonly string[]).includes(split)) {
    return { erro: `split desconhecido: ${split || "(vazio)"}` };
  }
  if (clip === "" || clip !== clip.split(/[\\/]/).pop()) {
    return { erro: `clip precisa ser somente o nome do arquivo: ${clip || "(vazio)"}` };
  }
  if (!/^[0-9a-f]{64}$/i.test(sha256)) {
    return { erro: `${clip}: SHA-256 ausente ou invalido` };
  }
  const anotacaoBruta = obj.anotacao;
  const anotacao: AnotacaoEntradaDatasetNsfw | undefined =
    anotacaoBruta && typeof anotacaoBruta === "object" && !Array.isArray(anotacaoBruta)
      ? (anotacaoBruta as AnotacaoEntradaDatasetNsfw)
      : undefined;
  return {
    entrada: {
      split: split as SplitDatasetNsfw,
      clip,
      sha256: sha256.toLowerCase(),
      ...(anotacao ? { anotacao } : {}),
    },
  };
}

/**
 * Valida separação, ausência de duplicatas e elegibilidade do split de teste.
 * Não verifica se o arquivo existe nem se o hash confere com seus bytes.
 */
export function validarDatasetNsfw(
  manifesto: unknown,
  entradas: ReadonlyArray<unknown> = []
): RelatorioDatasetNsfw {
  if (manifesto === null || typeof manifesto !== "object" || Array.isArray(manifesto)) {
    return vazio("manifesto ausente");
  }
  if (Array.isArray(entradas) === false || entradas.length === 0) {
    return vazio("manifesto sem entradas de clip");
  }

  const erros: string[] = [];
  const objetos = typeof manifesto === "object" ? manifesto as Record<string, unknown> : {};
  if (objetos.versaoEsquema !== 1) erros.push("manifesto requer versaoEsquema 1");

  const contagem: Record<SplitDatasetNsfw, number> = { treino: 0, tuning: 0, teste: 0 };
  const hashes = new Set<string>();
  const nomes = new Set<string>();
  const entradasValidas: EntradaDatasetNsfw[] = [];

  entradas.forEach((bruta, indice) => {
    const { entrada, erro } = normalizarEntradaDatasetNsfw(bruta);
    if (!entrada) {
      erros.push(`entrada ${indice + 1}: ${erro ?? "invalida"}`);
      return;
    }
    const hash = entrada.sha256 as string;
    if (hashes.has(hash)) erros.push(`${entrada.clip}: SHA-256 repetido (vazamento entre splits)`);
    if (nomes.has(entrada.clip)) erros.push(`${entrada.clip}: nome de clipe repetido`);
    hashes.add(hash);
    nomes.add(entrada.clip);
    contagem[entrada.split] += 1;
    entradasValidas.push(entrada);
  });

  const testes = entradasValidas.filter((entrada) => entrada.split === "teste");
  for (const entrada of testes) {
    const anotacao = entrada.anotacao;
    if (anotacao?.versaoEsquema !== 2) erros.push(`${entrada.clip}: anotacao de teste requer esquema v2`);
    if (anotacao?.conjunto !== "teste" && anotacao?.conjunto !== "eval") {
      erros.push(`${entrada.clip}: conjunto de teste deve ser "teste" ou "eval"`);
    }
    if (anotacao?.revisao?.status !== "revisada") {
      erros.push(`${entrada.clip}: anotacao de teste nao revisada por humano`);
    }
    if (
      anotacao?.resolucaoMs !== undefined &&
      (!Number.isFinite(anotacao.resolucaoMs) ||
        anotacao.resolucaoMs <= 0 ||
        anotacao.resolucaoMs >= 1_000)
    ) {
      erros.push(`${entrada.clip}: resolucao temporal nao e melhor que 1 fps`);
    }
  }

  if (testes.length === 0) erros.push("split de teste sem clipes");
  if (contagem.treino === 0) erros.push("split de treino sem clipes");

  const prontosParaMetricas =
    erros.length === 0 && testes.length > 0 && testes.every((entrada) => entrada.anotacao?.revisao?.status === "revisada");
  return {
    status: erros.length === 0 ? "valido" : "invalido",
    erros,
    contagem,
    hashesUnicos: hashes.size,
    prontosParaMetricas,
  };
}
