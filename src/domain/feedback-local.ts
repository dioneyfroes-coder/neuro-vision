/**
 * Feedback local sobre detecções e descrições (Fase 5, plano §14).
 *
 * Guarda **referências** (`frameId`, `cicloId`, rótulo) e texto do revisor —
 * nunca imagem, vídeo, log ou peso. A mídia continua no armazenamento local
 * existente e pode ser excluída independentemente; aqui basta remover o
 * registro. Módulo puro, sem IO e sem relógio implícito: `criadoEm` é fornecido
 * por quem chama.
 */

export type TipoFeedbackNsfw =
  | "falso_positivo"
  | "falso_negativo"
  | "descricao_incorreta"
  | "cronologia_incorreta"
  | "outro";

export const TIPOS_FEEDBACK_NSFW: readonly TipoFeedbackNsfw[] = [
  "falso_positivo",
  "falso_negativo",
  "descricao_incorreta",
  "cronologia_incorreta",
  "outro",
];

export interface RegistroFeedbackNsfw {
  id: string;
  tipo: TipoFeedbackNsfw;
  frameId?: string;
  cicloId?: string;
  rotulo?: string;
  descricao?: string;
  criadoEm: string;
  revisado: boolean;
}

export interface ResumoFeedbackNsfw {
  total: number;
  porTipo: Record<TipoFeedbackNsfw, number>;
  pendentes: number;
  revisados: number;
}

const CAMPOS_MIDIA = new Set(["imagem", "image", "base64", "video", "weights", "peso"]);

function texto(valor: unknown, max = 500): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo !== "" ? limpo.slice(0, max) : undefined;
}

/** Constrói um registro válido ou devolve `null` quando faltam campos-obrigatórios. */
export function normalizarFeedbackNsfw(valor: unknown): RegistroFeedbackNsfw | null {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return null;
  const obj = valor as Record<string, unknown>;
  const tipo = obj.tipo;
  if (typeof tipo !== "string" || !(TIPOS_FEEDBACK_NSFW as readonly string[]).includes(tipo)) {
    return null;
  }
  const id = texto(obj.id, 120);
  const criadoEm = texto(obj.criadoEm, 40);
  if (!id || !criadoEm || Number.isNaN(Date.parse(criadoEm))) return null;

  const registro: RegistroFeedbackNsfw = {
    id,
    tipo: tipo as TipoFeedbackNsfw,
    criadoEm,
    revisado: obj.revisado === true,
  };
  const frameId = texto(obj.frameId, 120);
  const cicloId = texto(obj.cicloId, 120);
  const rotulo = texto(obj.rotulo, 120);
  const descricao = texto(obj.descricao);
  if (frameId) registro.frameId = frameId;
  if (cicloId) registro.cicloId = cicloId;
  if (rotulo) registro.rotulo = rotulo;
  if (descricao) registro.descricao = descricao;
  return registro;
}

/** Lista campos de mídia que foram descartados (nunca persistidos). */
export function camposMidIADescartados(valor: unknown): string[] {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return [];
  return Object.keys(valor as Record<string, unknown>)
    .filter((chave) => CAMPOS_MIDIA.has(chave.toLowerCase()))
    .sort();
}

/** Deduplica por id, preservando a primeira ocorrência e a ordem de entrada. */
export function mesclarFeedbackNsfw(
  existentes: ReadonlyArray<RegistroFeedbackNsfw>,
  novos: ReadonlyArray<RegistroFeedbackNsfw>
): RegistroFeedbackNsfw[] {
  const vistos = new Set<string>();
  const resultado: RegistroFeedbackNsfw[] = [];
  for (const registro of [...existentes, ...novos]) {
    if (vistos.has(registro.id)) continue;
    vistos.add(registro.id);
    resultado.push(registro);
  }
  return resultado;
}

export function removerFeedbackNsfw(
  registros: ReadonlyArray<RegistroFeedbackNsfw>,
  id: string
): RegistroFeedbackNsfw[] {
  return registros.filter((registro) => registro.id !== id);
}

export function marcarFeedbackRevisado(
  registros: ReadonlyArray<RegistroFeedbackNsfw>,
  id: string
): RegistroFeedbackNsfw[] {
  return registros.map((registro) =>
    registro.id === id ? { ...registro, revisado: true } : registro
  );
}

export function resumoFeedbackNsfw(
  registros: ReadonlyArray<RegistroFeedbackNsfw>
): ResumoFeedbackNsfw {
  const porTipo = Object.fromEntries(TIPOS_FEEDBACK_NSFW.map((tipo) => [tipo, 0])) as Record<
    TipoFeedbackNsfw,
    number
  >;
  let revisados = 0;
  for (const registro of registros) {
    porTipo[registro.tipo] += 1;
    if (registro.revisado) revisados += 1;
  }
  return { total: registros.length, porTipo, pendentes: registros.length - revisados, revisados };
}

/** Exportação JSON somente com metadados — seguro para versionar ou compartilhar. */
export function exportarFeedbackNsfw(
  registros: ReadonlyArray<RegistroFeedbackNsfw>
): string {
  return JSON.stringify({ versao: 1, registros }, null, 2);
}
