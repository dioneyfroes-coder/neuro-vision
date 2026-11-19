/**
 * Frames processados em paralelo por ciclo. Limita a concorrencia para nao
 * disparar inferencias demais ao mesmo tempo (memoria/CPU): com 4 snapshots por
 * ciclo e 2 em paralelo, a espera cai mas o pico continua controlado. Ajustavel
 * por `DependenciasCicloMultiframe.concorrenciaFrames`.
 */
export const CONCORRENCIA_FRAMES_PADRAO = 2;

/**
 * Mapeia `itens` aplicando `tarefa` com concorrencia limitada, preservando a
 * ordem de entrada no resultado. Rejeita com o primeiro erro (o chamador trata
 * cancelamento/falha) e para de agendar novos itens assim que um falha — as
 * tarefas ja em andamento terminam, mas nenhuma nova e iniciada.
 */
export async function mapearConcorrente<T, R>(
  itens: readonly T[],
  concorrencia: number,
  tarefa: (item: T, indice: number) => Promise<R>
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  let falhou = false;
  const trabalhadores = Array.from({ length: Math.min(concorrencia, itens.length) }, async () => {
    while (!falhou) {
      const indice = proximo++;
      if (indice >= itens.length) return;
      try {
        resultados[indice] = await tarefa(itens[indice], indice);
      } catch (err) {
        falhou = true;
        throw err;
      }
    }
  });
  await Promise.all(trabalhadores);
  return resultados;
}