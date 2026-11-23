/**
 * Execucao limitada de tarefas assincronas para o conjunto NSFW (Fase 3).
 *
 * `Promise.all` direto dispara um worker por modelo ao mesmo tempo. Aqui o
 * limite é configurável e o resultado mantém a **mesma ordem dos ids**, mesmo
 * com tarefas terminando fora de ordem. Falha individual vira
 * `PromiseSettledResult`, nunca cancela a fila nem as demais tarefas.
 */

export interface ObservadorConcorrencia {
  /** Chamado no inicio/fim de cada tarefa para medir sobreposicao observada. */
  aoObservar?(emVoo: number): void;
}

/**
 * Roda `tarefa` sobre os itens com no maximo `limite` promises em voo.
 * `limite` ausente/nao finito preserva o paralelismo total de antes.
 */
export async function mapearComLimite<T, R>(
  itens: readonly T[],
  limite: number | undefined,
  tarefa: (item: T, indice: number) => Promise<R>,
  observador?: ObservadorConcorrencia
): Promise<PromiseSettledResult<R>[]> {
  const resultados = new Array<PromiseSettledResult<R>>(itens.length);
  if (itens.length === 0) return resultados;

  const normalizado =
    typeof limite === "number" && Number.isFinite(limite) ? Math.max(1, Math.floor(limite)) : itens.length;
  const n = Math.min(normalizado, itens.length);
  let proximo = 0;
  let emVoo = 0;

  const trabalhador = async (): Promise<void> => {
    while (true) {
      const indice = proximo;
      proximo += 1;
      if (indice >= itens.length) return;
      emVoo += 1;
      observador?.aoObservar?.(emVoo);
      try {
        resultados[indice] = { status: "fulfilled", value: await tarefa(itens[indice], indice) };
      } catch (reason) {
        resultados[indice] = { status: "rejected", reason };
      } finally {
        emVoo -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: n }, () => trabalhador()));
  return resultados;
}
