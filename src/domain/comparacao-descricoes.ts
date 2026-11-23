/**
 * Comparação lexical de descrições SFW × especializada (Fase 5, plano §14).
 *
 * É uma ferramenta de **inspeção local**, não uma métrica de qualidade: não
 * mede acurácia, omissão semântica nem preferência humana. Palavras são
 * normalizadas de forma determinística e sinônimos só entram quando declarados
 * explicitamente pelo chamador. Sem ambas as descrições o resultado é
 * `sem_dados`, nunca `0`.
 */

export interface OpcoesComparacaoDescricoes {
  /** Mapa de forma canônica → variantes aceitas (ex.: `penis: ["membro"]`). */
  sinonimos?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Palavras ignoradas na comparação. */
  ignorar?: ReadonlyArray<string>;
}

export interface ComparacaoDescricoes {
  status: "comparado" | "sem_dados";
  motivo?: string;
  /** Formas canônicas presentes nas duas descrições. */
  comuns: string[];
  /** Formas presentes apenas na descrição SFW. */
  somenteSfw: string[];
  /** Formas presentes apenas na descrição especializada. */
  somenteEspecializada: string[];
  /** Interseção/unição; `null` quando não há o que comparar. */
  semelhancaLexica: number | null;
}

const IGNORADAS_PADRAO = [
  "a", "as", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos",
  "nas", "o", "os", "um", "uma", "uns", "umas", "que", "com", "por", "para",
  "se", "ao", "aos", "pelo", "pela",
];

function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((parte) => parte.length > 0);
}

function canonizar(
  tokens: string[],
  sinonimos: Readonly<Record<string, ReadonlyArray<string>>>,
  ignorar: ReadonlySet<string>
): Set<string> {
  const mapa = new Map<string, string>();
  for (const [chave, variantes] of Object.entries(sinonimos)) {
    const alvo = chave.trim().toLowerCase();
    if (!alvo) continue;
    mapa.set(alvo, alvo);
    for (const variante of variantes) {
      const v = variante.trim().toLowerCase();
      if (v) mapa.set(v, alvo);
    }
  }
  const resultado = new Set<string>();
  for (const token of tokens) {
    if (ignorar.has(token)) continue;
    resultado.add(mapa.get(token) ?? token);
  }
  return resultado;
}

function vazio(motivo: string): ComparacaoDescricoes {
  return {
    status: "sem_dados",
    motivo,
    comuns: [],
    somenteSfw: [],
    somenteEspecializada: [],
    semelhancaLexica: null,
  };
}

/** Compara duas descrições já obtidas. Não executa modelo nem lê arquivo. */
export function compararDescricoes(
  sfw: string | null | undefined,
  especializada: string | null | undefined,
  opcoes: OpcoesComparacaoDescricoes = {}
): ComparacaoDescricoes {
  if (typeof sfw !== "string" || sfw.trim() === "") {
    return vazio("descricao SFW ausente");
  }
  if (typeof especializada !== "string" || especializada.trim() === "") {
    return vazio("descricao especializada ausente");
  }
  const ignorar = new Set(
    [...IGNORADAS_PADRAO, ...(opcoes.ignorar ?? [])].map((p) => p.trim().toLowerCase())
  );
  const a = canonizar(tokenizar(sfw), opcoes.sinonimos ?? {}, ignorar);
  const b = canonizar(tokenizar(especializada), opcoes.sinonimos ?? {}, ignorar);
  if (a.size === 0 && b.size === 0) return vazio("nenhuma palavra comparavel");

  const comuns = [...a].filter((t) => b.has(t)).sort();
  const somenteSfw = [...a].filter((t) => !b.has(t)).sort();
  const somenteEspecializada = [...b].filter((t) => !a.has(t)).sort();
  const uniao = new Set([...a, ...b]).size;
  return {
    status: "comparado",
    comuns,
    somenteSfw,
    somenteEspecializada,
    semelhancaLexica: uniao > 0 ? comuns.length / uniao : null,
  };
}
