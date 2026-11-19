import { indisponivel } from "../../../src/domain/perception";
import type { DependenciasPipelineLocal, ProcessarFrameLocal } from "./tipos";
import { PipelineLocal } from "./pipeline";

/** Cria o processador de frame a partir do pipeline, pronto para o ciclo. */
export function criarProcessadorFrameLocal(deps: DependenciasPipelineLocal): ProcessarFrameLocal {
  const pipeline = new PipelineLocal(deps);
  return (snapshot, sinal, amostragem) => pipeline.processarFrame(snapshot, sinal, amostragem);
}

/**
 * Processador inativo das variantes sem percepcao local (B · Sequência): todo
 * subsistema responde `indisponivel`, sem carregar modelo algum. O ciclo segue
 * valido — apenas nao ha evidencia local para o contexto multimodal nem para o
 * motor temporal, preservando a comparacao "apenas imagens".
 */
export function criarProcessadorInativo(): ProcessarFrameLocal {
  return () =>
    Promise.resolve({
      deteccoes: indisponivel("deteccao", "percepcao local desativada na variante"),
      pose: indisponivel("pose", "percepcao local desativada na variante"),
      maos: indisponivel("maos", "percepcao local desativada na variante"),
      metricas: {
        subsistemas: {
          deteccao: { status: "indisponivel", motivoFalha: "percepcao local desativada na variante" },
          pose: { status: "indisponivel", motivoFalha: "percepcao local desativada na variante" },
          maos: { status: "indisponivel", motivoFalha: "percepcao local desativada na variante" },
        },
      },
    });
}
