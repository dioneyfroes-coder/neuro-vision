/**
 * Avaliação de ações NSFW contra anotação humana revisada (Fase 4, plano §9.3).
 *
 * Replica a disciplina dos harnesses existentes: sem `conjunto: "eval"`,
 * `revisao.status: "revisada"`, esquema v2, resolução temporal melhor que 1 fps
 * e intervalos válidos, **nenhuma taxa é divulgada** — o resultado volta `N/A`
 * com motivo, nunca `0`. A correspondência é por sobreposição de intervalos,
 * determinística e sem interpretação semântica de descrições.
 */

export interface AnotacaoAcaoNsfw {
  descricao?: string;
  inicioEm?: string;
  fimEm?: string;
  frameIds?: readonly string[];
}

export interface AnotacaoNsfw {
  versaoEsquema?: number;
  conjunto?: string;
  revisao?: { status?: string };
  resolucaoMs?: number;
  acoes?: ReadonlyArray<AnotacaoAcaoNsfw>;
}

export interface AcaoInferidaNsfw {
  descricao?: string;
  inicioEm?: string;
  fimEm?: string;
  evidencias?: readonly string[];
}

export interface AvaliacaoNsfwAnotada {
  status: "medido" | "N/A";
  motivo?: string;
  acoesAnotadas: number;
  acoesInferidas: number;
  correspondencias: number;
  falsosPositivos: number;
  omissoes: number;
  precisao: number | null;
  recall: number | null;
}

interface Intervalo {
  inicio: number;
  fim: number;
}

function ms(valor: string | undefined): number | undefined {
  if (typeof valor !== "string") return undefined;
  const obtido = Date.parse(valor);
  return Number.isFinite(obtido) ? obtido : undefined;
}

function intervalo(acao: { inicioEm?: string; fimEm?: string }): Intervalo | undefined {
  const inicio = ms(acao.inicioEm);
  const fim = ms(acao.fimEm);
  if (inicio === undefined || fim === undefined || inicio > fim) return undefined;
  return { inicio, fim };
}

function sobrepoem(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

function vazio(motivo: string): AvaliacaoNsfwAnotada {
  return {
    status: "N/A",
    motivo,
    acoesAnotadas: 0,
    acoesInferidas: 0,
    correspondencias: 0,
    falsosPositivos: 0,
    omissoes: 0,
    precisao: null,
    recall: null,
  };
}

/**
 * Compara ações inferidas com a anotação. Nunca executa modelo, nunca lê arquivo
 * e nunca converte concordância entre detectores em precisão/recall.
 */
export function avaliarAcoesNsfwAnotadas(
  anotacao: AnotacaoNsfw | null | undefined,
  inferidas: ReadonlyArray<AcaoInferidaNsfw> = []
): AvaliacaoNsfwAnotada {
  if (anotacao === null || typeof anotacao !== "object") {
    return vazio("sem anotacao humana revisada");
  }
  if (anotacao.versaoEsquema !== 2) return vazio("esquema de anotacao nao e v2");
  if (anotacao.conjunto !== "eval") return vazio("conjunto nao e eval");
  if (anotacao.revisao?.status !== "revisada") return vazio("anotacao nao revisada por humano");
  if (
    typeof anotacao.resolucaoMs !== "number" ||
    !Number.isFinite(anotacao.resolucaoMs) ||
    anotacao.resolucaoMs <= 0 ||
    anotacao.resolucaoMs >= 1_000
  ) {
    return vazio("resolucao temporal nao e melhor que 1 fps");
  }

  const referencias = (anotacao.acoes ?? []).map(intervalo).filter((i): i is Intervalo => i !== undefined);
  const obtidas = inferidas.map(intervalo).filter((i): i is Intervalo => i !== undefined);
  if (referencias.length === 0) return vazio("anotacao sem acoes com intervalo valido");
  if (obtidas.length === 0) return vazio("resposta sem acoes com intervalo valido");

  // Correspondência gulosa determinística: cada inferida casa com no máximo uma
  // anotada, na ordem em que aparece na resposta do modelo.
  const usadas = new Set<number>();
  let correspondencias = 0;
  for (const inferida of obtidas) {
    const indice = referencias.findIndex((ref, i) => !usadas.has(i) && sobrepoem(inferida, ref));
    if (indice >= 0) {
      usadas.add(indice);
      correspondencias += 1;
    }
  }

  const omissoes = referencias.length - usadas.size;
  const falsosPositivos = obtidas.length - correspondencias;
  return {
    status: "medido",
    acoesAnotadas: referencias.length,
    acoesInferidas: obtidas.length,
    correspondencias,
    falsosPositivos,
    omissoes,
    precisao: correspondencias / obtidas.length,
    recall: correspondencias / referencias.length,
  };
}
