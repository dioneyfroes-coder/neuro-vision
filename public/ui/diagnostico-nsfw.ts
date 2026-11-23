/**
 * Diagnostico do conjunto NSFW (Fase 1 do plano de evolucao).
 *
 * A telemetria por modelo e a fonte da verdade: um modelo indisponivel precisa
 * aparecer pelo nome e pelo motivo, sem transformar falha parcial em "NSFW
 * desligado" nem em "nenhuma marcacao". Assim como o diagnostico de
 * persistencia, a regra fica pura e testavel fora de `public/app.ts`.
 */

import type { MetricasAdaptador } from "../perception/contracts";

/** Falhas individuais com o motivo de cada modelo, na ordem do catalogo. */
export function modelosNsfwIndisponiveis(metricas: MetricasAdaptador): string[] {
  return (metricas.telemetriaModelos ?? [])
    .filter((telemetria) => telemetria.status === "indisponivel")
    .map((telemetria) =>
      telemetria.motivoFalha
        ? `${telemetria.modelo}: ${telemetria.motivoFalha}`
        : telemetria.modelo
    );
}

/**
 * Parte da linha de diagnostico quando o NSFW esta ativo. Sem falha individual
 * nao ha texto: `undefined` (nao rodou) continua distinto de "rodou e falhou".
 */
export function partesDiagnosticoNsfw(
  metricas: MetricasAdaptador | undefined,
  ativo: boolean
): string[] {
  if (!ativo || !metricas) return [];
  const falhas = modelosNsfwIndisponiveis(metricas);
  if (falhas.length === 0) return [];
  const total = metricas.telemetriaModelos?.length ?? 0;
  return [`nsfw falhas ${falhas.length}/${total}: ${falhas.join("; ")}`];
}
