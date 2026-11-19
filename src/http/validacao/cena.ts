/** Validação/normalização de payloads de referência/comparação de cena. */
import type { ItemCena, OpcoesComparacaoCena } from "../../domain/cena";
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
  return opcoes;
}
