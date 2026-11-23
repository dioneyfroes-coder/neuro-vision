/**
 * Agrupamento espacial de marcações NSFW com hipóteses conflitantes (Fase 3).
 *
 * O conjunto atual deduplica apenas rótulos iguais com IoU alto; rótulos
 * diferentes na mesma região viram duas marcações independentes, como se
 * fossem dois objetos. Este módulo é puro: agrupa por **geometria primeiro** e
 * preserva cada rótulo como hipótese, sem eleger um "correto".
 *
 * A regra padrão (IoU ≥ 0,6) repete a deduplicação atual; as demais métricas
 * existem para o benchmark comparativo do plano. Nenhuma delas foi escolhida
 * por precisão: isso exigiria exemplos anotados e revisão humana.
 */

import type { Caixa, MarcacaoNsfw } from "./perception";

export type CriterioAgrupamentoNsfw = "iou" | "ios" | "contencao" | "centros";

/** Limiares explícitos; `contencao` é booleano (1 = uma caixa contém a outra). */
export const LIMIARES_AGRUPAMENTO_NSFW: Readonly<Record<CriterioAgrupamentoNsfw, number>> = {
  iou: 0.6,
  ios: 0.6,
  contencao: 1,
  centros: 0.5,
};

export interface OpcoesAgrupamentoEspacialNsfw {
  /** Métrica de associação; default `iou` (compatível com a mesclagem atual). */
  criterio?: CriterioAgrupamentoNsfw;
  /** Limiar da métrica; default da tabela `LIMIARES_AGRUPAMENTO_NSFW`. */
  limiar?: number;
}

export interface HipoteseEspacialNsfw {
  rotulo: string;
  modelo?: string;
  score: number;
  /** Caixa original, sem consolidação — preserva a evidência de cada modelo. */
  caixaOriginal: Caixa;
}

export interface GrupoEspacialNsfw {
  regiaoId: string;
  /** União das caixas do grupo (mínimos/máximos). */
  caixaConsolidada: Caixa;
  hipoteses: HipoteseEspacialNsfw[];
  status: "concordancia" | "conflito_semantico";
  modelos: string[];
  scoreMaximo: number;
}

export interface AgrupamentoEspacialNsfw {
  grupos: GrupoEspacialNsfw[];
  criterio: CriterioAgrupamentoNsfw;
  limiar: number;
  totalMarcacoes: number;
  totalGruposConflitantes: number;
}

function area(caixa: Caixa): number {
  return Math.max(0, caixa.xmax - caixa.xmin) * Math.max(0, caixa.ymax - caixa.ymin);
}

function intersecao(a: Caixa, b: Caixa): number {
  const x1 = Math.max(a.xmin, b.xmin);
  const y1 = Math.max(a.ymin, b.ymin);
  const x2 = Math.min(a.xmax, b.xmax);
  const y2 = Math.min(a.ymax, b.ymax);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/** IoU clássico: interseção sobre união. */
export function iouCaixasNsfw(a: Caixa, b: Caixa): number {
  const inter = intersecao(a, b);
  const uniao = area(a) + area(b) - inter;
  return uniao > 0 ? inter / uniao : 0;
}

/** IoS: interseção sobre a menor caixa — ajuda quando uma caixa é muito maior. */
export function iosCaixasNsfw(a: Caixa, b: Caixa): number {
  const menor = Math.min(area(a), area(b));
  return menor > 0 ? intersecao(a, b) / menor : 0;
}

/** 1 quando uma caixa contém a outra (tolerância numérica); 0 caso contrário. */
export function contencaoCaixasNsfw(a: Caixa, b: Caixa): number {
  const contem = (externa: Caixa, interna: Caixa) =>
    externa.xmin <= interna.xmin + 1e-9 &&
    externa.ymin <= interna.ymin + 1e-9 &&
    externa.xmax >= interna.xmax - 1e-9 &&
    externa.ymax >= interna.ymax - 1e-9;
  return contem(a, b) || contem(b, a) ? 1 : 0;
}

/**
 * Distância entre centros dividida pela raiz da área da união — sem unidade,
 * comparável em caixas em pixels ou normalizadas.
 */
export function distanciaCentrosNormalizadaNsfw(a: Caixa, b: Caixa): number {
  const uniao = area(a) + area(b) - intersecao(a, b);
  if (uniao <= 0) return Number.POSITIVE_INFINITY;
  const cxA = (a.xmin + a.xmax) / 2;
  const cyA = (a.ymin + a.ymax) / 2;
  const cxB = (b.xmin + b.xmax) / 2;
  const cyB = (b.ymin + b.ymax) / 2;
  return Math.hypot(cxA - cxB, cyA - cyB) / Math.sqrt(uniao);
}

/** Valor da métrica escolhida para um par de caixas. */
export function metricaAgrupamentoNsfw(
  a: Caixa,
  b: Caixa,
  criterio: CriterioAgrupamentoNsfw
): number {
  switch (criterio) {
    case "ios":
      return iosCaixasNsfw(a, b);
    case "contencao":
      return contencaoCaixasNsfw(a, b);
    case "centros":
      return distanciaCentrosNormalizadaNsfw(a, b);
    case "iou":
      return iouCaixasNsfw(a, b);
  }
}

/**
 * `centros` é uma distância: associa quando **menor ou igual** ao limiar.
 * As demais são similaridade: associam quando maiores ou iguais.
 */
export function associarCaixasNsfw(
  a: Caixa,
  b: Caixa,
  criterio: CriterioAgrupamentoNsfw,
  limiar: number
): boolean {
  const valor = metricaAgrupamentoNsfw(a, b, criterio);
  if (!Number.isFinite(valor)) return false;
  return criterio === "centros" ? valor <= limiar : valor >= limiar;
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compararCaixa(a: Caixa, b: Caixa): number {
  return (
    a.xmin - b.xmin ||
    a.ymin - b.ymin ||
    a.xmax - b.xmax ||
    a.ymax - b.ymax
  );
}

function uniaoCaixas(marcas: readonly MarcacaoNsfw[]): Caixa {
  return marcas.reduce<Caixa>(
    (acc, m) => ({
      xmin: Math.min(acc.xmin, m.caixa.xmin),
      ymin: Math.min(acc.ymin, m.caixa.ymin),
      xmax: Math.max(acc.xmax, m.caixa.xmax),
      ymax: Math.max(acc.ymax, m.caixa.ymax),
    }),
    { ...marcas[0].caixa }
  );
}

function modelosDaMarca(m: MarcacaoNsfw): string[] {
  return m.modelos?.length ? [...m.modelos] : m.modelo ? [m.modelo] : [];
}

/**
 * Monta grupos determinísticos a partir das marcações brutas (uma por modelo,
 * antes da mesclagem). A ordem de entrada não altera a saída.
 */
export function criarGruposEspaciaisNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfw>,
  opcoes: OpcoesAgrupamentoEspacialNsfw = {}
): AgrupamentoEspacialNsfw {
  const criterio = opcoes.criterio ?? "iou";
  const limiar = opcoes.limiar ?? LIMIARES_AGRUPAMENTO_NSFW[criterio];
  const ordenadas = [...marcacoes].sort(
    (a, b) =>
      b.score - a.score ||
      compararTexto(a.rotulo, b.rotulo) ||
      compararTexto(a.modelo ?? "", b.modelo ?? "") ||
      compararCaixa(a.caixa, b.caixa)
  );

  const linguetas: { representante: Caixa; marcas: MarcacaoNsfw[] }[] = [];
  for (const marcacao of ordenadas) {
    const existente = linguetas.find((g) =>
      associarCaixasNsfw(marcacao.caixa, g.representante, criterio, limiar)
    );
    if (existente) existente.marcas.push(marcacao);
    else linguetas.push({ representante: { ...marcacao.caixa }, marcas: [marcacao] });
  }

  const grupos = linguetas
    .map(({ marcas }) => {
      const rotulos = new Set(marcas.map((m) => m.rotulo));
      const modelos = [...new Set(marcas.flatMap(modelosDaMarca))].sort(compararTexto);
      return {
        regiaoId: "",
        caixaConsolidada: uniaoCaixas(marcas),
        hipoteses: marcas.map((m) => ({
          rotulo: m.rotulo,
          ...(m.modelo ? { modelo: m.modelo } : {}),
          score: m.score,
          caixaOriginal: { ...m.caixa },
        })),
        status: rotulos.size > 1 ? ("conflito_semantico" as const) : ("concordancia" as const),
        modelos,
        scoreMaximo: Math.max(...marcas.map((m) => m.score)),
      } satisfies GrupoEspacialNsfw;
    })
    .sort(
      (a, b) =>
        b.scoreMaximo - a.scoreMaximo ||
        compararCaixa(a.caixaConsolidada, b.caixaConsolidada) ||
        compararTexto(a.hipoteses[0].rotulo, b.hipoteses[0].rotulo)
    )
    .map((grupo, indice) => ({ ...grupo, regiaoId: `r-${indice + 1}` }));

  return {
    grupos,
    criterio,
    limiar,
    totalMarcacoes: marcacoes.length,
    totalGruposConflitantes: grupos.filter((g) => g.status === "conflito_semantico").length,
  };
}
