import { criarRegistroCiclo } from "../../../src/domain/cycle";
import type { ErroEtapa, ResultadoCiclo } from "../../../src/domain/cycle";
import { ErroPercepcao } from "../../../src/erros";
import type { DependenciasCicloMultiframe } from "./tipos";

export function cancelado(): ErroPercepcao {
  return new ErroPercepcao("cancelamento", "ciclo cancelado");
}

/**
 * Persiste o diagnostico do ciclo em modo best-effort. Devolve o tempo gasto
 * (ms) para alimentar `metricas.persistenciaMs`.
 */
export async function persistirDiagnostico(
  deps: DependenciasCicloMultiframe,
  resultado: ResultadoCiclo,
  erros: ErroEtapa[]
): Promise<number> {
  if (!deps.persistirCiclo) return 0;
  const agora = deps.agora ?? (() => performance.now());
  const inicio = agora();
  try {
    await deps.persistirCiclo(criarRegistroCiclo(resultado));
  } catch (err) {
    erros.push({ etapa: "persistencia", mensagem: (err as Error).message });
  }
  return Math.round(agora() - inicio);
}