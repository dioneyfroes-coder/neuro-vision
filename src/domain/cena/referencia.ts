import type { ItemCena, ReferenciaCena } from "./tipos";
import { copiarItem, finito, itemCenaValido } from "./validacao";

/**
 * Consolida o inventário inicial. Quando há mais de uma detecção do mesmo
 * rótulo, prevalece a de maior confiança (desempate por `objetoId`) — nunca a
 * última chegada, para que o resultado não dependa da ordem do lote.
 */
export function construirReferencia(opcoes: {
  sessaoId: string;
  itens: ItemCena[];
  criadaEmMs: number;
  quadros?: number;
}): ReferenciaCena {
  if (typeof opcoes.sessaoId !== "string" || !/^[A-Za-z0-9_-]+$/.test(opcoes.sessaoId)) {
    throw new Error("sessaoId deve usar apenas letras, digitos, _ e -");
  }
  if (!finito(opcoes.criadaEmMs)) throw new Error("criadaEmMs deve ser finito");
  if (opcoes.quadros !== undefined && (!finito(opcoes.quadros) || opcoes.quadros < 1)) {
    throw new Error("quadros deve ser inteiro maior ou igual a 1");
  }
  for (const item of opcoes.itens) {
    if (!itemCenaValido(item)) throw new Error(`Item de cena invalido: ${JSON.stringify(item)}`);
  }
  const porRotulo = new Map<string, ItemCena>();
  for (const item of opcoes.itens) {
    const anterior = porRotulo.get(item.rotulo);
    if (
      !anterior ||
      item.confianca > anterior.confianca ||
      (item.confianca === anterior.confianca && item.objetoId < anterior.objetoId)
    ) {
      porRotulo.set(item.rotulo, copiarItem(item));
    }
  }
  return {
    sessaoId: opcoes.sessaoId,
    criadaEmMs: opcoes.criadaEmMs,
    quadros: Math.trunc(opcoes.quadros ?? 1),
    itens: [...porRotulo.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo)),
  };
}
