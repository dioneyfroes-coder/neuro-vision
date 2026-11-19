import { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import {
  JANELA_EVIDENCIA_ANTES_MS,
  JANELA_EVIDENCIA_DEPOIS_MS,
  vincularInstanteAosSegmentos,
} from "../../domain/vinculo-evento-video";
import { ReferenciaVideoEventoApi } from "../../types";
import { parsearInstante } from "../validacao";

/**
 * Anexa a cada registro da pagina os trechos de video que cobrem seu instante.
 * O indice e consultado uma unica vez com a janela da pagina; o vinculo e
 * derivado na leitura, entao segmentos gravados depois passam a aparecer.
 */
export async function anexarTrechosDeVideo<T extends object>(
  registros: readonly T[],
  instante: (registro: T) => string | undefined,
  monitoramento: ServicoMonitoramento
): Promise<Array<T & { segmentos: ReferenciaVideoEventoApi[] }>> {
  if (registros.length === 0) return [];
  const instantes = registros.map((registro) => parsearInstante(instante(registro) ?? null));
  let inicioJanela = Number.POSITIVE_INFINITY;
  let fimJanela = Number.NEGATIVE_INFINITY;
  for (const ms of instantes) {
    if (ms === undefined) continue;
    inicioJanela = Math.min(inicioJanela, ms - JANELA_EVIDENCIA_ANTES_MS);
    fimJanela = Math.max(fimJanela, ms + JANELA_EVIDENCIA_DEPOIS_MS);
  }
  const segmentos = Number.isFinite(inicioJanela)
    ? await monitoramento.segmentosParaIntervalo(inicioJanela, fimJanela, 5000)
    : [];

  return registros.map((registro, i) => {
    const ms = instantes[i];
    return {
      ...registro,
      segmentos:
        ms === undefined
          ? []
          : vincularInstanteAosSegmentos(ms, segmentos).map((ref) => ({
              ...ref,
              url: `/api/monitoramento/videos/${encodeURIComponent(ref.segmentoId)}`,
            })),
    };
  });
}
