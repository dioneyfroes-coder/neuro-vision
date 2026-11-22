/**
 * Política de retenção de vídeos (Fase 7, plano §9.2).
 *
 * Regra pura e determinística: recebe metadados já listados e devolve o que
 * deve ser removido. Nunca apaga nada, não lê relógio e não conhece o disco —
 * a aplicação fica no `ArmazenadorVideos`. A idade é contada a partir do
 * `criadoEmMs` declarado no upload, nunca de inferência sobre o conteúdo.
 */

/** Campos mínimos necessários para decidir a retenção. */
export interface AlvoRetencao {
  segmentoId: string;
  criadoEmMs: number;
  bytes: number;
}

export interface PoliticaRetencaoVideos {
  /** Idade máxima em ms; `0` desativa. */
  maxIdadeMs: number;
  /** Quantidade máxima de arquivos; `0` desativa. */
  maxArquivos: number;
  /** Total máximo de bytes; `0` desativa. */
  maxBytesTotais: number;
  /** Segmentos associados a eventos importantes, preservados explicitamente. */
  preservarSegmentoIds?: readonly string[];
}

export interface MotivosRetencao {
  [segmentoId: string]: Array<"idade" | "quantidade" | "espaco">;
}

export interface ResultadoRetencao {
  remover: AlvoRetencao[];
  preservados: string[];
  motivos: MotivosRetencao;
}

function validarLimite(valor: number, nome: string): void {
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error(`${nome} deve ser finito e nao negativo`);
  }
}

function ordenarAntigos(arquivos: AlvoRetencao[]): AlvoRetencao[] {
  return [...arquivos].sort(
    (a, b) => a.criadoEmMs - b.criadoEmMs || a.segmentoId.localeCompare(b.segmentoId)
  );
}

/**
 * Seleta arquivos expirados por idade, excesso de quantidade ou excesso de
 * espaço. Um arquivo preservado nunca entra na lista, mesmo se violar limites;
 * a decisão e os motivos ficam registrados para auditoria.
 */
export function selecionarParaRetencao(
  arquivos: AlvoRetencao[],
  politica: PoliticaRetencaoVideos,
  agoraMs: number
): ResultadoRetencao {
  validarLimite(politica.maxIdadeMs, "maxIdadeMs");
  validarLimite(politica.maxArquivos, "maxArquivos");
  validarLimite(politica.maxBytesTotais, "maxBytesTotais");
  if (!Number.isFinite(agoraMs)) throw new Error("agoraMs deve ser finito");

  const preservar = new Set(politica.preservarSegmentoIds ?? []);
  const elegiveis = arquivos.filter((arquivo) => {
    if (preservar.has(arquivo.segmentoId)) return false;
    return Number.isFinite(arquivo.criadoEmMs) && Number.isFinite(arquivo.bytes) && arquivo.bytes >= 0;
  });
  const motivos: MotivosRetencao = {};
  const marcar = (arquivo: AlvoRetencao, motivo: "idade" | "quantidade" | "espaco"): void => {
    const lista = motivos[arquivo.segmentoId] ?? [];
    if (!lista.includes(motivo)) lista.push(motivo);
    motivos[arquivo.segmentoId] = lista;
  };

  const antigos = ordenarAntigos(elegiveis);
  if (politica.maxIdadeMs > 0) {
    for (const arquivo of antigos) {
      if (arquivo.criadoEmMs + politica.maxIdadeMs <= agoraMs) marcar(arquivo, "idade");
    }
  }
  if (politica.maxArquivos > 0) {
    for (const arquivo of antigos.slice(0, Math.max(0, antigos.length - politica.maxArquivos))) {
      marcar(arquivo, "quantidade");
    }
  }
  if (politica.maxBytesTotais > 0) {
    let total = arquivos.reduce((soma, arquivo) => soma + Math.max(0, arquivo.bytes), 0);
    for (const arquivo of antigos) {
      if (total <= politica.maxBytesTotais) break;
      marcar(arquivo, "espaco");
      total -= Math.max(0, arquivo.bytes);
    }
  }

  const porId = new Map(arquivos.map((arquivo) => [arquivo.segmentoId, arquivo]));
  const remover = antigos.filter((arquivo) => (motivos[arquivo.segmentoId]?.length ?? 0) > 0);
  const removidos = new Set(remover.map((arquivo) => arquivo.segmentoId));
  return {
    remover,
    preservados: arquivos
      .filter((arquivo) => preservar.has(arquivo.segmentoId) && porId.has(arquivo.segmentoId))
      .map((arquivo) => arquivo.segmentoId),
    motivos: Object.fromEntries(
      Object.entries(motivos).filter(([id]) => removidos.has(id))
    ),
  };
}
