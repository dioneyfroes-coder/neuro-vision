/**
 * Métricas por classe e por modelo (Fase 6, plano §16).
 *
 * Só divulga números quando há anotação revisada do conjunto de teste e
 * respostas já coletadas. Sem isso, `precisao`/`recall`/`f1` são `null` e o
 * motivo é explícito. O cálculo é uma contagem determinística por rótulo —
 * nunca interpreta concordância entre detectores como acerto.
 */

export interface ReferenciaClasseNsfw {
  classe: string;
  modelo?: string;
  clip?: string;
}

export interface InferenciaClasseNsfw {
  classe: string;
  modelo?: string;
  clip?: string;
}

export interface AnotacaoMetricasNsfw {
  versaoEsquema?: number;
  conjunto?: string;
  revisao?: { status?: string };
  referencias?: ReadonlyArray<ReferenciaClasseNsfw>;
}

export interface MetricasClasseModeloNsfw {
  modelo: string;
  clip: string;
  classe: string;
  tp: number;
  fp: number;
  fn: number;
  precisao: number | null;
  recall: number | null;
  f1: number | null;
}

export interface RelatorioMetricasNsfwPorClasse {
  status: "medido" | "sem_dados";
  motivo?: string;
  base?: "anotacao-revisada";
  porModeloClasse: MetricasClasseModeloNsfw[];
  macro: { precisao: number | null; recall: number | null; f1: number | null };
}

const MODELO_DESCONHECIDO = "(modelo_nao_informado)";
const SEPARADOR = "::";

function vazio(motivo: string): RelatorioMetricasNsfwPorClasse {
  return {
    status: "sem_dados",
    motivo,
    porModeloClasse: [],
    macro: { precisao: null, recall: null, f1: null },
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function razao(tp: number, denom: number): number | null {
  return denom > 0 ? tp / denom : null;
}

function calcularF1(precisao: number | null, recall: number | null): number | null {
  if (precisao === null || recall === null) return null;
  const soma = precisao + recall;
  return soma > 0 ? (2 * precisao * recall) / soma : 0;
}

/**
 * Compara duas listas de rótulos já normalizados. A correspondência é por
 * contagem dentro de `(clip, modelo, classe)`: determinística e sem casamento
 * semântico entre rótulos diferentes.
 */
export function calcularMetricasNsfwPorClasse(
  anotacao: AnotacaoMetricasNsfw | null | undefined,
  inferidas: ReadonlyArray<InferenciaClasseNsfw> = []
): RelatorioMetricasNsfwPorClasse {
  if (anotacao === null || typeof anotacao !== "object") return vazio("sem anotacao revisada");
  if (anotacao.versaoEsquema !== 2) return vazio("esquema de anotacao nao e v2");
  if (anotacao.conjunto !== "teste" && anotacao.conjunto !== "eval") {
    return vazio("conjunto nao e teste/eval");
  }
  if (anotacao.revisao?.status !== "revisada") return vazio("anotacao nao revisada por humano");

  const referencias = (anotacao.referencias ?? []).filter(
    (item): item is ReferenciaClasseNsfw =>
      item !== null && typeof item === "object" && texto(item.classe) !== ""
  );
  if (referencias.length === 0) return vazio("anotacao sem referencias por classe");
  if (inferidas.length === 0) return vazio("respostas sem inferencias por classe");

  const inferenciasValidas = inferidas.filter(
    (item): item is InferenciaClasseNsfw =>
      item !== null && typeof item === "object" && texto(item.classe) !== ""
  );
  if (inferenciasValidas.length === 0) return vazio("respostas sem rotulos validos");

  const chave = (item: { classe: string; modelo?: string; clip?: string }): string =>
    [texto(item.clip) || "-", texto(item.modelo) || MODELO_DESCONHECIDO, texto(item.classe)].join(
      SEPARADOR
    );
  const chaves = new Set<string>();
  const referenciasPorChave = new Map<string, number>();
  const inferidasPorChave = new Map<string, number>();
  for (const item of referencias) {
    const atual = chave(item);
    chaves.add(atual);
    referenciasPorChave.set(atual, (referenciasPorChave.get(atual) ?? 0) + 1);
  }
  for (const item of inferenciasValidas) {
    const atual = chave(item);
    chaves.add(atual);
    inferidasPorChave.set(atual, (inferidasPorChave.get(atual) ?? 0) + 1);
  }

  const porModeloClasse: MetricasClasseModeloNsfw[] = [];
  for (const atual of chaves) {
    const referenciasN = referenciasPorChave.get(atual) ?? 0;
    const inferidasN = inferidasPorChave.get(atual) ?? 0;
    const tp = Math.min(referenciasN, inferidasN);
    const fp = Math.max(0, inferidasN - referenciasN);
    const fn = Math.max(0, referenciasN - inferidasN);
    const [clip, modelo, classe] = atual.split(SEPARADOR);
    const precisao = razao(tp, tp + fp);
    const recall = razao(tp, tp + fn);
    porModeloClasse.push({
      modelo: modelo || MODELO_DESCONHECIDO,
      clip,
      classe,
      tp,
      fp,
      fn,
      precisao,
      recall,
      f1: calcularF1(precisao, recall),
    });
  }
  porModeloClasse.sort((a, b) =>
    [a.modelo, a.clip, a.classe].join(SEPARADOR).localeCompare([b.modelo, b.clip, b.classe].join(SEPARADOR))
  );

  const media = (valores: number[]): number | null =>
    valores.length > 0 ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
  const precisaoMacro = media(
    porModeloClasse.flatMap((item) => (item.precisao === null ? [] : [item.precisao]))
  );
  const recallMacro = media(
    porModeloClasse.flatMap((item) => (item.recall === null ? [] : [item.recall]))
  );

  return {
    status: "medido",
    base: "anotacao-revisada",
    porModeloClasse,
    macro: {
      precisao: precisaoMacro,
      recall: recallMacro,
      f1: calcularF1(precisaoMacro, recallMacro),
    },
  };
}
