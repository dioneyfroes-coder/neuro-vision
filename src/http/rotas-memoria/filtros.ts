/** Leitura e validação dos filtros de eventos temporais na query string. */
import { ACOES_EVENTO, type FiltrosEventoTemporais } from "../../domain";
import {
  ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS,
  TIPOS_EVENTO_TEMPORAL_PERSISTIDOS,
} from "../persistencia";
import { parsearInstante } from "../validacao";

/** Lista separada por vírgulas, sem valores vazios. */
export function valoresCsv(url: URL, chave: string): string[] {
  return (url.searchParams.get(chave) ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor) => valor.length > 0);
}

export function parsearFiltrosEventosTemporais(url: URL): FiltrosEventoTemporais {
  const tipos = valoresCsv(url, "tipo").filter((valor) =>
    TIPOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(valor as (typeof TIPOS_EVENTO_TEMPORAL_PERSISTIDOS)[number])
  );
  const estados = valoresCsv(url, "estado").filter((valor) =>
    ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(valor as (typeof ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS)[number])
  );
  const acoes = valoresCsv(url, "acao").filter((valor) =>
    (ACOES_EVENTO as readonly string[]).includes(valor)
  );
  return {
    tipos,
    estados,
    acoes,
    entidadeId: url.searchParams.get("entidadeId")?.trim() || undefined,
    sessionId: url.searchParams.get("sessionId")?.trim() || undefined,
    pessoaEntidadeId:
      url.searchParams.get("pessoa")?.trim() || url.searchParams.get("pessoaEntidadeId")?.trim() || undefined,
    objetos: valoresCsv(url, "objeto"),
    participantes: valoresCsv(url, "participante"),
    desdeMs: parsearInstante(url.searchParams.get("desde")),
    ateMs: parsearInstante(url.searchParams.get("ate")),
  };
}

/** Filtros aplicados, em texto, para o cabeçalho de metadados da exportação. */
export function descreverFiltros(url: URL): Record<string, string> {
  const descricao: Record<string, string> = {};
  for (const chave of [
    "tipo",
    "estado",
    "acao",
    "entidadeId",
    "sessionId",
    "pessoa",
    "objeto",
    "participante",
    "desde",
    "ate",
    "segmentoId",
  ]) {
    const valor = url.searchParams.get(chave)?.trim();
    if (valor) descricao[chave] = valor;
  }
  return descricao;
}
