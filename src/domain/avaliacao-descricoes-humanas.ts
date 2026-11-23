/**
 * Avaliação cega de descrições com revisão humana (Fase 6, plano §16).
 *
 * Prepara pares com ordem A/B determinística e **sem revelar a origem** ao
 * revisor. Só publica contagens quando cada amostra tem revisores suficientes;
 * sem revisão o resultado é `sem_dados`. A preferência observada não é taxa de
 * acerto nem prova de qualidade — é apenas registro controlado de opinião.
 */

export interface ParDescricoesNsfw {
  id: string;
  sfw: string;
  especializada: string;
}

export type OrigemDescricaoNsfw = "sfw" | "especializada";
export type PreferenciaDescricaoNsfw = "A" | "B" | "empate" | "inconclusivo";

export interface AmostraCegaDescricaoNsfw {
  id: string;
  textoA: string;
  textoB: string;
}

export interface MapaCegoDescricaoNsfw {
  [amostraId: string]: { A: OrigemDescricaoNsfw; B: OrigemDescricaoNsfw };
}

export interface RevisaoDescricaoNsfw {
  amostraId: string;
  revisorId: string;
  preferencia: PreferenciaDescricaoNsfw;
  comentario?: string;
}

export interface ConsensoDescricaoNsfw {
  amostraId: string;
  preferencia: PreferenciaDescricaoNsfw;
  origemPreferida: OrigemDescricaoNsfw | "sem_preferencia";
  concordancia: number;
  revisores: number;
}

export interface RelatorioDescricoesHumanasNsfw {
  status: "observado" | "sem_dados";
  motivo?: string;
  amostras: number;
  revisoresDistintos: number;
  amostrasComConsenso: number;
  concordanciaMedia: number | null;
  preferenciasPorOrigem: Record<OrigemDescricaoNsfw | "sem_preferencia", number>;
  porAmostra: ConsensoDescricaoNsfw[];
}

const PREFERENCIAS: readonly PreferenciaDescricaoNsfw[] = [
  "A",
  "B",
  "empate",
  "inconclusivo",
];

function vazio(motivo: string): RelatorioDescricoesHumanasNsfw {
  return {
    status: "sem_dados",
    motivo,
    amostras: 0,
    revisoresDistintos: 0,
    amostrasComConsenso: 0,
    concordanciaMedia: null,
    preferenciasPorOrigem: { sfw: 0, especializada: 0, sem_preferencia: 0 },
    porAmostra: [],
  };
}

/** Ordem A/B derivada do id — estável entre execuções, sem `Math.random()`. */
function trocar(id: string): boolean {
  let soma = 0;
  for (let i = 0; i < id.length; i += 1) soma += id.charCodeAt(i) * (i + 1);
  return soma % 2 === 1;
}

export function prepararAmostrasCegasNsfw(
  pares: ReadonlyArray<ParDescricoesNsfw>
): { amostras: AmostraCegaDescricaoNsfw[]; mapa: MapaCegoDescricaoNsfw } {
  const amostras: AmostraCegaDescricaoNsfw[] = [];
  const mapa: MapaCegoDescricaoNsfw = {};
  for (const par of pares) {
    if (!par || typeof par.id !== "string" || par.id.trim() === "") continue;
    const id = par.id.trim();
    const invertido = trocar(id);
    const A: OrigemDescricaoNsfw = invertido ? "especializada" : "sfw";
    const B: OrigemDescricaoNsfw = invertido ? "sfw" : "especializada";
    amostras.push({
      id,
      textoA: invertido ? par.especializada : par.sfw,
      textoB: invertido ? par.sfw : par.especializada,
    });
    mapa[id] = { A, B };
  }
  return { amostras, mapa };
}

export function avaliarDescricoesHumanasNsfw(
  amostras: ReadonlyArray<AmostraCegaDescricaoNsfw>,
  mapa: MapaCegoDescricaoNsfw,
  revisoes: ReadonlyArray<RevisaoDescricaoNsfw>,
  opcoes: { minRevisores?: number } = {}
): RelatorioDescricoesHumanasNsfw {
  if (amostras.length === 0) return vazio("sem amostras cegas");
  if (revisoes.length === 0) return vazio("sem revisao humana");
  const minimo = Number.isInteger(opcoes.minRevisores) && (opcoes.minRevisores as number) > 0
    ? (opcoes.minRevisores as number)
    : 2;

  const ids = new Set(amostras.map((amostra) => amostra.id));
  const porAmostra = new Map<string, Map<string, PreferenciaDescricaoNsfw>>();
  for (const revisao of revisoes) {
    if (!revisao || !ids.has(revisao.amostraId)) continue;
    if (!(PREFERENCIAS as readonly string[]).includes(revisao.preferencia)) continue;
    if (typeof revisao.revisorId !== "string" || revisao.revisorId.trim() === "") continue;
    const revisores = porAmostra.get(revisao.amostraId) ?? new Map();
    revisores.set(revisao.revisorId, revisao.preferencia);
    porAmostra.set(revisao.amostraId, revisores);
  }
  if (porAmostra.size === 0) return vazio("revisoes fora das amostras cegas");
  if ([...porAmostra.values()].some((revisores) => revisores.size < minimo)) {
    return vazio(`amostra sem ${minimo} revisores distintos`);
  }

  const preferenciasPorOrigem: Record<OrigemDescricaoNsfw | "sem_preferencia", number> = {
    sfw: 0,
    especializada: 0,
    sem_preferencia: 0,
  };
  const detalhes: ConsensoDescricaoNsfw[] = [];
  let concordancias = 0;

  for (const amostra of amostras) {
    const revisores = porAmostra.get(amostra.id);
    if (!revisores) continue;
    const valores = [...revisores.values()];
    const contagem = new Map<PreferenciaDescricaoNsfw, number>();
    for (const valor of valores) contagem.set(valor, (contagem.get(valor) ?? 0) + 1);
    const preferencia = [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const concordancia = (contagem.get(preferencia) ?? 0) / valores.length;
    const mapeamento = mapa[amostra.id];
    const origemPreferida: OrigemDescricaoNsfw | "sem_preferencia" =
      preferencia === "A" || preferencia === "B"
        ? mapeamento?.[preferencia] ?? "sem_preferencia"
        : "sem_preferencia";
    preferenciasPorOrigem[origemPreferida] += 1;
    concordancias += concordancia;
    detalhes.push({
      amostraId: amostra.id,
      preferencia,
      origemPreferida,
      concordancia,
      revisores: valores.length,
    });
  }

  return {
    status: "observado",
    amostras: amostras.length,
    revisoresDistintos: new Set(revisoes.map((revisao) => revisao.revisorId)).size,
    amostrasComConsenso: detalhes.filter((item) => item.origemPreferida !== "sem_preferencia").length,
    concordanciaMedia: detalhes.length > 0 ? concordancias / detalhes.length : null,
    preferenciasPorOrigem,
    porAmostra: detalhes,
  };
}
