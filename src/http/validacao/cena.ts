/** Validação/normalização de payloads de referência/comparação de cena. */
import type {
  ConsolidacaoReferenciaCena,
  ItemCena,
  OpcoesComparacaoCena,
} from "../../domain/cena";
import { itemCenaValido } from "../../domain/cena";

/* ------------------------------------------------------------------------- *
 * Referencia do ambiente e mudancas (Fase 3)
 * ------------------------------------------------------------------------- */

/** Corpo de `POST .../cena/referencia` e `POST .../cena/comparar`. */
export function montarItensCena(payload: unknown): ItemCena[] | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(p.itens)) return "campo 'itens' obrigatorio (lista)";
  for (const item of p.itens) {
    if (!itemCenaValido(item)) {
      return `item de cena invalido: ${JSON.stringify(item)}`;
    }
  }
  return p.itens as ItemCena[];
}

/** Opcoes numericas da comparacao, cada uma dentro do intervalo permitido. */
export function montarComparacaoCena(payload: unknown): OpcoesComparacaoCena | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const opcoes: OpcoesComparacaoCena = {};
  for (const [chave, maximo] of [
    ["iouMinimo", 1],
    ["distanciaMaxima", 2],
  ] as const) {
    const valor = p[chave];
    if (valor === undefined || valor === null) continue;
    const n = typeof valor === "number" ? valor : Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > maximo) {
      return `campo '${chave}' deve estar em [0, ${maximo}]`;
    }
    opcoes[chave] = n;
  }
  const porInstancia = p.associacaoPorInstancia;
  if (porInstancia !== undefined && porInstancia !== null) {
    if (typeof porInstancia !== "boolean") {
      return "campo 'associacaoPorInstancia' deve ser booleano";
    }
    opcoes.associacaoPorInstancia = porInstancia;
  }
  return opcoes;
}

export type ResultadoConsolidacaoCena =
  | { ok: true; valor?: ConsolidacaoReferenciaCena }
  | { ok: false; erro: string };

/** Modo de consolidação do inventário, quando informado. */
export function montarConsolidacaoCena(payload: unknown): ResultadoConsolidacaoCena {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const valor = p.consolidacao;
  if (valor === undefined || valor === null) return { ok: true };
  if (valor !== "automatica" && valor !== "instancia" && valor !== "rotulo") {
    return { ok: false, erro: "campo 'consolidacao' deve ser automatica, instancia ou rotulo" };
  }
  return { ok: true, valor };
}
