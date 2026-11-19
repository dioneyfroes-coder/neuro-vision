/** `true` quando o ciclo foi concluido (nao cancelado) e tem metricas. */
export function ehCicloUtil(registro) {
  return Boolean(registro) && registro.cancelado !== true && Boolean(registro.metricas);
}

export function filtrarPorPolitica(registros, politica) {
  if (!politica) return registros;
  return registros.filter((registro) => registro?.politica?.id === politica);
}

/** Descarta os N primeiros ciclos uteis (aquecimento de modelo/compilacao). */
export function aplicarWarmup(registros, warmup = 0) {
  if (warmup <= 0) return registros;
  let descartados = 0;
  return registros.filter((registro) => {
    if (!ehCicloUtil(registro) || descartados >= warmup) return true;
    descartados += 1;
    return false;
  });
}
