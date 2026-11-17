/**
 * Índice durável de sessões e segmentos de monitoramento (Fase 3).
 *
 * O núcleo (`GerenciadorGravacao`) mantém a sessão viva em memória; este
 * repositório guarda as **atualizações** dessa sessão e dos seus segmentos em
 * JSONL append-only. Cada transição (início, pausa, retomada, encerramento) e
 * cada abertura/fechamento de segmento acrescenta uma linha; a leitura mantém a
 * versão mais recente por `sessaoId`/`segmentoId`, para que o índice continue
 * coerente mesmo depois de uma reabertura do servidor.
 *
 * A gravação dos **bytes** de vídeo não passa por aqui: o índice descreve
 * timestamps, cobertura e lacunas, não o conteúdo do arquivo.
 */
import { appendJsonl, lerUltimosJsonl } from "./armazenamento-jsonl";
import type { SessaoMonitoramento, VideoSegment } from "../domain";

/** Acrescenta uma atualização de sessão (append-only, com rotação). */
export async function gravarSessaoMonitoramento(
  sessao: SessaoMonitoramento,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(sessao, filePath, maxBytes);
}

/** Acrescenta uma atualização de segmento (append-only, com rotação). */
export async function gravarSegmentoMonitoramento(
  segmento: VideoSegment,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(segmento, filePath, maxBytes);
}

/**
 * Lê as sessões conhecidas, uma por `sessaoId`, da mais recente para a mais
 * antiga. `limit` conta **atualizações** lidas do arquivo, não sessões únicas:
 * uma sessão com várias transições consome mais de uma linha do limite.
 */
export async function lerSessoesMonitoramento(
  filePath: string,
  limit: number
): Promise<SessaoMonitoramento[]> {
  const atualizacoes = await lerUltimosJsonl<SessaoMonitoramento>(filePath, limit);
  const vistas = new Set<string>();
  const sessoes: SessaoMonitoramento[] = [];
  for (const sessao of atualizacoes) {
    if (!sessao?.sessaoId || vistas.has(sessao.sessaoId)) continue;
    vistas.add(sessao.sessaoId);
    sessoes.push(sessao);
  }
  return sessoes.sort((a, b) => b.iniciadaEmMs - a.iniciadaEmMs);
}

/**
 * Lê os segmentos conhecidos, um por `segmentoId`, em ordem cronológica. Como
 * em `lerSessoesMonitoramento`, `limit` conta atualizações lidas do arquivo.
 */
export async function lerSegmentosMonitoramento(
  filePath: string,
  limit: number
): Promise<VideoSegment[]> {
  const atualizacoes = await lerUltimosJsonl<VideoSegment>(filePath, limit);
  const vistos = new Map<string, VideoSegment>();
  for (const segmento of atualizacoes) {
    if (!segmento?.segmentoId || vistos.has(segmento.segmentoId)) continue;
    vistos.set(segmento.segmentoId, segmento);
  }
  return [...vistos.values()].sort(
    (a, b) => a.inicioMs - b.inicioMs || a.sequencia - b.sequencia
  );
}

/** Lê os segmentos de uma sessão, em ordem cronológica. */
export async function lerSegmentosDaSessao(
  filePath: string,
  sessaoId: string,
  limit: number
): Promise<VideoSegment[]> {
  const segmentos = await lerSegmentosMonitoramento(filePath, limit);
  return segmentos.filter((segmento) => segmento.sessaoId === sessaoId);
}
