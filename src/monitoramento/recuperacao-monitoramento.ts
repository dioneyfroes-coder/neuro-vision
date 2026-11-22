/**
 * Recuperação de sessão abandonada após queda do processo (Fase 7, plano §9.5).
 *
 * O plano é **puro**: lê o índice durável e a lista de arquivos de vídeo e
 * devolve decisões; não grava, não apaga e não inventa cobertura. O intervalo
 * depois do último quadro conhecido é registrado como lacuna (não coberto),
 * nunca como gravação. A aplicação das decisões fica em `aplicar-recuperacao.ts`.
 */
import type { LacunaGravacao, SessaoMonitoramento, VideoSegment } from "../domain";

/** Metadado de vídeo já listado no armazenador. */
export interface ArquivoVideoConhecido {
  segmentoId: string;
}

export interface EntradaRecuperacaoMonitoramento {
  sessoes: SessaoMonitoramento[];
  segmentos: VideoSegment[];
  arquivosVideo: readonly ArquivoVideoConhecido[];
  /** Instante da recuperação, injetado para manter a regra determinística. */
  agoraMs: number;
}

export interface SegmentoRecuperado {
  anterior: VideoSegment;
  recuperado: VideoSegment;
}

export interface SessaoRecuperada {
  anterior: SessaoMonitoramento;
  recuperada: SessaoMonitoramento;
  segmentos: SegmentoRecuperado[];
}

export interface PlanoRecuperacaoMonitoramento {
  geradoEmMs: number;
  recuperacoes: SessaoRecuperada[];
  /** Segmentos abertos cuja sessão já estava encerrada no índice. */
  segmentosOrfaos: SegmentoRecuperado[];
  /** Segmentos que estavam abertos e passaram a `incompleto`. */
  segmentosIncompletos: string[];
  /**
   * Segmentos fechados/incompletos sem arquivo de vídeo. A ausência pode ser
   * upload interrompido **ou** exclusão intencional; o plano não decide qual.
   */
  uploadsPendentes: string[];
  observacoes: string[];
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function copiarSegmento(segmento: VideoSegment): VideoSegment {
  return { ...segmento, lacunas: segmento.lacunas.map((lacuna) => ({ ...lacuna })) };
}

function incompletar(
  segmento: VideoSegment,
  agoraMs: number
): { segmento: VideoSegment; lacunaAdicionada: boolean } {
  const recuperado = copiarSegmento(segmento);
  recuperado.estado = "incompleto";
  recuperado.motivoFim = "lacuna";
  // `fimMs`/`duracaoMs` permanecem no último quadro: a recuperação não estende
  // a cobertura do segmento com tempo em que não havia gravação.
  let lacunaAdicionada = false;
  if (Number.isFinite(recuperado.fimMs) && agoraMs > recuperado.fimMs) {
    const lacuna: LacunaGravacao = {
      inicioEm: iso(recuperado.fimMs),
      inicioMs: recuperado.fimMs,
      fimEm: iso(agoraMs),
      fimMs: agoraMs,
      duracaoMs: agoraMs - recuperado.fimMs,
      motivo: "falha",
    };
    recuperado.lacunas.push(lacuna);
    lacunaAdicionada = true;
  }
  return { segmento: recuperado, lacunaAdicionada };
}

/** Monta o plano. Nenhuma sessão viva em memória é necessária ou modificada. */
export function planejarRecuperacaoMonitoramento(
  entrada: EntradaRecuperacaoMonitoramento
): PlanoRecuperacaoMonitoramento {
  if (!Number.isFinite(entrada.agoraMs)) throw new Error("agoraMs deve ser finito");
  const { sessoes, segmentos, arquivosVideo, agoraMs } = entrada;
  const observacoes: string[] = [];
  const recuperacoes: SessaoRecuperada[] = [];
  const segmentosOrfaos: SegmentoRecuperado[] = [];
  const segmentosIncompletos: string[] = [];
  const abandonadas = sessoes.filter(
    (sessao) => sessao.estado === "ativa" || sessao.estado === "pausada"
  );

  for (const sessao of abandonadas) {
    const daSessao = segmentos.filter(
      (segmento) => segmento.sessaoId === sessao.sessaoId && segmento.estado === "gravando"
    );
    const alterados: SegmentoRecuperado[] = [];
    for (const segmento of daSessao) {
      const { segmento: recuperado, lacunaAdicionada } = incompletar(segmento, agoraMs);
      alterados.push({ anterior: segmento, recuperado });
      segmentosIncompletos.push(segmento.segmentoId);
      if (lacunaAdicionada) {
        observacoes.push(`lacuna_registrada:${segmento.segmentoId}`);
      }
    }
    const recuperada: SessaoMonitoramento = {
      ...sessao,
      estado: "interrompida",
      encerradaEm: iso(agoraMs),
      encerradaEmMs: agoraMs,
    };
    recuperacoes.push({ anterior: sessao, recuperada, segmentos: alterados });
    observacoes.push(
      daSessao.length > 0
        ? `sessao_abandonada_fechada:${sessao.sessaoId};ultimo_quadro=${Math.max(
            ...daSessao.map((segmento) => segmento.fimMs)
          )}`
        : `sessao_abandonada_fechada:${sessao.sessaoId};sem_quadro_conhecido`
    );
  }

  const idsAbandonadas = new Set(abandonadas.map((sessao) => sessao.sessaoId));
  for (const segmento of segmentos) {
    if (segmento.estado !== "gravando" || idsAbandonadas.has(segmento.sessaoId)) continue;
    // Segmento órfão: sessão já encerrada no índice, mas gravação nunca foi
    // fechada. Também vira incompleto — sem estender a cobertura.
    const { segmento: recuperado } = incompletar(segmento, agoraMs);
    segmentosIncompletos.push(segmento.segmentoId);
    segmentosOrfaos.push({ anterior: segmento, recuperado });
    observacoes.push(`segmento_aberto_sem_sessao_abandonada:${segmento.segmentoId}`);
  }

  const comArquivo = new Set(arquivosVideo.map((arquivo) => arquivo.segmentoId));
  const uploadsPendentes = segmentos
    .filter((segmento) => segmento.estado !== "gravando" && !comArquivo.has(segmento.segmentoId))
    .map((segmento) => segmento.segmentoId);
  if (uploadsPendentes.length > 0) {
    observacoes.push(`sem_arquivo_de_video:${uploadsPendentes.length}`);
  }

  return {
    geradoEmMs: agoraMs,
    recuperacoes,
    segmentosOrfaos,
    segmentosIncompletos,
    uploadsPendentes,
    observacoes,
  };
}
