/**
 * Resumo de concorrencia/latencia a partir de janelas instrumentadas (Fase 3).
 *
 * Esta rotina **nao executa modelos e nao mede hardware**: ela resume amostras
 * de inicio/fim ja coletadas. Sem amostras validas devolve `sem_dados` com
 * `null` nos numeros — nunca `0`, nunca "aprovado". Os percentis sao medidas
 * descritivas das amostras fornecidas, nao uma estimativa da maquina de referencia.
 */

export interface AmostraConcorrenciaNsfw {
  modelo: string;
  /** Instante de inicio da tarefa, em ms (relativo ou absoluto). */
  inicioMs: number;
  /** Instante do fim da tarefa, em ms, na mesma base de `inicioMs`. */
  fimMs: number;
  /** A tarefa terminou em falha? Entra na contagem, nao nos percentis. */
  falha?: boolean;
}

export interface ResumoConcorrenciaNsfw {
  status: "medido" | "sem_dados";
  motivo?: string;
  amostras: number;
  amostrasInvalidas: number;
  modelos: string[];
  /** Maximo de janelas sobrepostas; `null` quando nao ha medicacao. */
  concorrenciaMaxima: number | null;
  latenciaMs: { p50: number | null; p95: number | null; max: number | null };
  falhas: number;
}

function percentil(ordenados: readonly number[], fracao: number): number | null {
  if (ordenados.length === 0) return null;
  const indice = Math.max(0, Math.ceil(fracao * ordenados.length) - 1);
  return ordenados[indice];
}

function valida(amostra: AmostraConcorrenciaNsfw | null | undefined): amostra is AmostraConcorrenciaNsfw {
  return (
    amostra !== null &&
    typeof amostra === "object" &&
    typeof amostra.modelo === "string" &&
    amostra.modelo.trim().length > 0 &&
    Number.isFinite(amostra.inicioMs) &&
    Number.isFinite(amostra.fimMs) &&
    amostra.fimMs >= amostra.inicioMs
  );
}

/** varredura de eventos: fim antes de inicio no mesmo instante (intervalo meio-aberto). */
function concorrenciaMaxima(amostras: readonly AmostraConcorrenciaNsfw[]): number {
  const eventos: { tempo: number; delta: number }[] = [];
  for (const a of amostras) {
    eventos.push({ tempo: a.inicioMs, delta: 1 }, { tempo: a.fimMs, delta: -1 });
  }
  eventos.sort((a, b) => a.tempo - b.tempo || a.delta - b.delta);
  let atual = 0;
  let maximo = 0;
  for (const evento of eventos) {
    atual += evento.delta;
    if (atual > maximo) maximo = atual;
  }
  return maximo;
}

/** Resume janelas ja coletadas; nao inventa numeros quando nao ha amostras. */
export function resumirConcorrenciaNsfw(
  amostras: ReadonlyArray<AmostraConcorrenciaNsfw>
): ResumoConcorrenciaNsfw {
  const validas = amostras.filter(valida);
  const invalidas = amostras.length - validas.length;
  const latencias = validas
    .filter((a) => !a.falha)
    .map((a) => a.fimMs - a.inicioMs)
    .sort((a, b) => a - b);

  if (validas.length === 0) {
    return {
      status: "sem_dados",
      motivo:
        invalidas > 0
          ? `${invalidas} amostra(s) invalida(s); nenhuma janela utilizavel`
          : "nenhuma amostra instrumentada de execucao real",
      amostras: 0,
      amostrasInvalidas: invalidas,
      modelos: [],
      concorrenciaMaxima: null,
      latenciaMs: { p50: null, p95: null, max: null },
      falhas: 0,
    };
  }

  return {
    status: "medido",
    amostras: validas.length,
    amostrasInvalidas: invalidas,
    modelos: [...new Set(validas.map((a) => a.modelo))].sort(),
    concorrenciaMaxima: concorrenciaMaxima(validas),
    latenciaMs: {
      p50: percentil(latencias, 0.5),
      p95: percentil(latencias, 0.95),
      max: latencias.length ? latencias[latencias.length - 1] : null,
    },
    falhas: validas.filter((a) => a.falha).length,
  };
}
