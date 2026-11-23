/**
 * Proveniência declarada de pesos (Fase 6, plano §16).
 *
 * Módulo puro: valida um **manifesto textual**, sem baixar nada, abrir arquivos
 * de peso nem inferir revisão a partir de `resolve/main`. O manifesto existe
 * para tornar um benchmark reproduzível; sem ele o relatório é `sem_dados` e
 * nenhuma origem/licença/hash é afirmada.
 */

export interface PesoDeclaradoNsfw {
  /** Identificador lógico ou nome de arquivo/pasta — nunca caminho absoluto. */
  nome: string;
  funcao: string;
  fonte?: string;
  licenca?: string;
  /** SHA do commit/revisão do repositório de origem (40 hex). */
  revisao?: string;
  /** SHA-256 do arquivo de peso (64 hex). */
  sha256?: string;
  tamanhoBytes?: number;
}

export interface RelatorioProvenienciaNsfw {
  status: "valido" | "invalido" | "sem_dados";
  motivo?: string;
  erros: string[];
  pesos: number;
  comLicenca: number;
  comSha256: number;
  comRevisao: number;
  /** Fontes que usam `resolve/main`: o conteúdo pode mudar sem trocar de ID. */
  fontesMoveis: number;
  prontosParaBenchmark: boolean;
}

const CAMPOS_PROIBIDOS = new Set([
  "base64", "conteudo", "conteúdo", "payload", "binario", "binário", "datauri",
]);

function vazio(motivo: string): RelatorioProvenienciaNsfw {
  return {
    status: "sem_dados",
    motivo,
    erros: [],
    pesos: 0,
    comLicenca: 0,
    comSha256: 0,
    comRevisao: 0,
    fontesMoveis: 0,
    prontosParaBenchmark: false,
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function caminhoRelativo(valor: string): boolean {
  return !/^[a-zA-Z]:[\\/]/.test(valor) && !valor.startsWith("/") && !valor.includes("..");
}

/** Normaliza uma declaração externa sem copiar campos de mídia incorporada. */
export function normalizarPesoDeclaradoNsfw(valor: unknown): {
  peso?: PesoDeclaradoNsfw;
  erro?: string;
} {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    return { erro: "declaracao nao e objeto" };
  }
  const obj = valor as Record<string, unknown>;
  const proibidos = Object.keys(obj)
    .filter((chave) => CAMPOS_PROIBIDOS.has(chave.toLowerCase()))
    .sort();
  if (proibidos.length > 0) return { erro: `campos de midia/peso incorporado: ${proibidos.join(", ")}` };

  const nome = texto(obj.nome);
  const funcao = texto(obj.funcao);
  if (nome === "" || !caminhoRelativo(nome)) return { erro: `nome invalido: ${nome || "(vazio)"}` };
  if (funcao === "") return { erro: `${nome}: funcao nao declarada` };

  const sha256 = texto(obj.sha256);
  const revisao = texto(obj.revisao);
  const fonte = texto(obj.fonte);
  const licenca = texto(obj.licenca);
  const tamanhoBytes = obj.tamanhoBytes;
  if (sha256 !== "" && !/^[0-9a-f]{64}$/i.test(sha256)) return { erro: `${nome}: SHA-256 invalido` };
  if (revisao !== "" && !/^[0-9a-f]{40}$/i.test(revisao)) return { erro: `${nome}: revisao nao e SHA de 40 hex` };
  if (
    tamanhoBytes !== undefined &&
    (!Number.isSafeInteger(tamanhoBytes) || (tamanhoBytes as number) < 0)
  ) {
    return { erro: `${nome}: tamanhoBytes invalido` };
  }

  return {
    peso: {
      nome,
      funcao,
      ...(fonte ? { fonte } : {}),
      ...(licenca ? { licenca } : {}),
      ...(revisao ? { revisao: revisao.toLowerCase() } : {}),
      ...(sha256 ? { sha256: sha256.toLowerCase() } : {}),
      ...(typeof tamanhoBytes === "number" ? { tamanhoBytes } : {}),
    },
  };
}

export function validarProvenienciaPesos(
  manifesto: unknown,
  pesos: ReadonlyArray<unknown> = []
): RelatorioProvenienciaNsfw {
  if (manifesto === null || typeof manifesto !== "object" || Array.isArray(manifesto)) {
    return vazio("manifesto de pesos ausente");
  }
  if (pesos.length === 0) return vazio("manifesto sem pesos declarados");

  const erros: string[] = [];
  const objetos = manifesto as Record<string, unknown>;
  if (objetos.versaoEsquema !== 1) erros.push("manifesto requer versaoEsquema 1");

  const declarados: PesoDeclaradoNsfw[] = [];
  pesos.forEach((bruto, indice) => {
    const { peso, erro } = normalizarPesoDeclaradoNsfw(bruto);
    if (!peso) {
      erros.push(`peso ${indice + 1}: ${erro ?? "invalido"}`);
      return;
    }
    if (declarados.some((item) => item.nome === peso.nome)) {
      erros.push(`${peso.nome}: declarado mais de uma vez`);
    }
    declarados.push(peso);
  });

  for (const peso of declarados) {
    if (!texto(peso.licenca)) erros.push(`${peso.nome}: licenca nao declarada`);
    if (!texto(peso.sha256)) erros.push(`${peso.nome}: SHA-256 nao declarado`);
    if (!texto(peso.revisao)) erros.push(`${peso.nome}: revisao da fonte nao declarada`);
    if (!texto(peso.fonte)) erros.push(`${peso.nome}: fonte nao declarada`);
  }

  const fontesMoveis = declarados.filter((peso) => /\/resolve\/main(?:[/]|$)/i.test(peso.fonte ?? "")).length;
  if (fontesMoveis > 0) {
    erros.push(`${fontesMoveis} fonte(s) usam resolve/main; fixe a revisao antes do benchmark`);
  }

  return {
    status: erros.length === 0 ? "valido" : "invalido",
    erros,
    pesos: declarados.length,
    comLicenca: declarados.filter((peso) => Boolean(texto(peso.licenca))).length,
    comSha256: declarados.filter((peso) => Boolean(texto(peso.sha256))).length,
    comRevisao: declarados.filter((peso) => Boolean(texto(peso.revisao))).length,
    fontesMoveis,
    prontosParaBenchmark: erros.length === 0 && declarados.length > 0,
  };
}
