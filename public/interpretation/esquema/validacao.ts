import { ContextoCicloSerializavel } from "./tipos";

/** Resultado da validacao das referencias citadas pela interpretacao. */
export interface ReferenciasValidadas {
  /** IDs citados que existem no contexto (frames + eventos). */
  validas: string[];
  /** IDs citados que nao existem em nenhum frame/evento real. */
  invalidas: string[];
}

/**
 * Conjunto de IDs reais do contexto: frameIds enviados, eventoIds e frames de
 * evidencia citados pelos eventos. Incluir a evidencia do evento preserva a
 * ligacao mesmo quando o frame nao esta entre as imagens amostradas.
 */
export function idsReais(contexto: ContextoCicloSerializavel): Set<string> {
  const ids = new Set<string>();
  for (const frame of contexto.frames) ids.add(frame.frameId);
  for (const evento of contexto.eventosTemporais) {
    ids.add(evento.eventoId);
    for (const evidencia of evento.evidencias) ids.add(evidencia);
  }
  return ids;
}

/**
 * Valida os IDs citados pelo modelo multimodal contra os frames e eventos
 * **reais** do contexto (item 6). Acepta tanto `frameId`/`eventoId` completos
 * quanto o indice 1-based da imagem (`"Imagem 1"`, `"1"`), resolvendo-o para o
 * `frameId` correspondente. Referencias inexistentes sao separadas em
 * `invalidas` (nunca fundidas na lista valida). Mantem a ordem e remove
 * duplicatas.
 */
export function validarReferencias(
  contexto: ContextoCicloSerializavel,
  citados: readonly string[]
): ReferenciasValidadas {
  const reais = idsReais(contexto);
  const porIndice = new Map<number, string>();
  for (const frame of contexto.frames) porIndice.set(frame.indice, frame.frameId);

  const validas: string[] = [];
  const invalidas: string[] = [];
  const vistosValidos = new Set<string>();
  const vistosInvalidos = new Set<string>();

  for (const bruto of citados) {
    if (typeof bruto !== "string" || bruto.trim() === "") continue;
    const referencia = normalizarReferencia(bruto, porIndice);
    if (referencia && reais.has(referencia)) {
      if (!vistosValidos.has(referencia)) {
        vistosValidos.add(referencia);
        validas.push(referencia);
      }
      continue;
    }
    const chave = bruto.trim();
    if (!vistosInvalidos.has(chave)) {
      vistosInvalidos.add(chave);
      invalidas.push(chave);
    }
  }

  return { validas, invalidas };
}

/**
 * Normaliza uma referencia textual do modelo para um `frameId`/`eventoId`:
 * aceita o ID exato, `"Imagem N"`, `"frame N"` ou apenas um indice numerico.
 * Devolve `null` quando nao ha correspondencia.
 */
function normalizarReferencia(
  bruto: string,
  porIndice: Map<number, string>
): string | null {
  const texto = bruto.trim();
  const indice = texto.match(/^(?:imagem|frame)?\s*(\d+)$/i);
  if (indice) {
    const n = Number(indice[1]);
    return porIndice.get(n) ?? null;
  }
  return texto;
}