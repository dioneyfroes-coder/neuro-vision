import { STATUS_EVIDENCIA_VALIDOS } from "../evidencia";
import type { AssociacaoInstanciaCena, ConfirmacaoCena, ItemCena, RegiaoCena } from "./tipos";

const ASSOCIACOES_INSTANCIA: ReadonlySet<string> = new Set<AssociacaoInstanciaCena>([
  "estavel",
  "ambiga",
]);

const CONFIRMACOES: ReadonlySet<string> = new Set<ConfirmacaoCena>([
  "confirmado",
  "possivel",
  "ocluido",
  "nao_confirmado",
  "nao_observado",
]);

export function finito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

/** Converte uma caixa em pixels para coordenadas normalizadas. */
export function normalizarCaixaCena(
  caixa: RegiaoCena,
  larguraPx: number,
  alturaPx: number
): RegiaoCena {
  if (!finito(larguraPx) || larguraPx <= 0 || !finito(alturaPx) || alturaPx <= 0) {
    throw new Error("larguraPx e alturaPx devem ser finitos e maiores que zero");
  }
  const cortar = (valor: number) => Math.max(0, Math.min(1, valor));
  const xmin = cortar(caixa.xmin / larguraPx);
  const xmax = cortar(caixa.xmax / larguraPx);
  const ymin = cortar(caixa.ymin / alturaPx);
  const ymax = cortar(caixa.ymax / alturaPx);
  return {
    xmin: Math.min(xmin, xmax),
    ymin: Math.min(ymin, ymax),
    xmax: Math.max(xmin, xmax),
    ymax: Math.max(ymin, ymax),
  };
}

export function caixaCenaValida(caixa: unknown): caixa is RegiaoCena {
  if (!caixa || typeof caixa !== "object") return false;
  const c = caixa as Record<string, unknown>;
  return (
    finito(c.xmin) &&
    finito(c.ymin) &&
    finito(c.xmax) &&
    finito(c.ymax) &&
    c.xmin >= 0 &&
    c.ymin >= 0 &&
    c.xmax <= 1 &&
    c.ymax <= 1 &&
    c.xmin <= c.xmax &&
    c.ymin <= c.ymax
  );
}

export function itemCenaValido(item: unknown): item is ItemCena {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.objetoId === "string" &&
    i.objetoId.trim().length > 0 &&
    typeof i.rotulo === "string" &&
    i.rotulo.trim().length > 0 &&
    caixaCenaValida(i.caixa) &&
    typeof i.confirmacao === "string" &&
    CONFIRMACOES.has(i.confirmacao) &&
    finito(i.confianca) &&
    i.confianca >= 0 &&
    i.confianca <= 1 &&
    (i.estadoObjeto === undefined || typeof i.estadoObjeto === "string") &&
    (i.frameId === undefined || typeof i.frameId === "string") &&
    (i.observadoEmMs === undefined || finito(i.observadoEmMs)) &&
    (i.instanciaId === undefined ||
      (typeof i.instanciaId === "string" && i.instanciaId.trim().length > 0)) &&
    (i.classe === undefined || (typeof i.classe === "string" && i.classe.trim().length > 0)) &&
    (i.primeiraObservacaoEmMs === undefined || finito(i.primeiraObservacaoEmMs)) &&
    (i.ultimaObservacaoEmMs === undefined || finito(i.ultimaObservacaoEmMs)) &&
    (i.frameIds === undefined ||
      (Array.isArray(i.frameIds) && i.frameIds.every((id) => typeof id === "string"))) &&
    (i.confiancaAssociacao === undefined ||
      (finito(i.confiancaAssociacao) && i.confiancaAssociacao >= 0 && i.confiancaAssociacao <= 1)) &&
    (i.associacao === undefined ||
      ASSOCIACOES_INSTANCIA.has(i.associacao as AssociacaoInstanciaCena)) &&
    (i.statusEvidencia === undefined ||
      STATUS_EVIDENCIA_VALIDOS.some((status) => status === i.statusEvidencia))
  );
}

export function copiarItem(item: ItemCena): ItemCena {
  return {
    ...item,
    caixa: { ...item.caixa },
    frameIds: item.frameIds ? [...item.frameIds] : undefined,
  };
}

/** Igualdade de posição/estado ignorando o id temporário do rastro. */
export function mesmoItem(a: ItemCena, b: ItemCena): boolean {
  return (
    a.rotulo === b.rotulo &&
    a.confirmacao === b.confirmacao &&
    a.estadoObjeto === b.estadoObjeto &&
    a.caixa.xmin === b.caixa.xmin &&
    a.caixa.ymin === b.caixa.ymin &&
    a.caixa.xmax === b.caixa.xmax &&
    a.caixa.ymax === b.caixa.ymax
  );
}
