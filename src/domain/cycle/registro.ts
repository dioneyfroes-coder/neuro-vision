import type { ResultadoIndisponivel } from "../perception";
import { estaIndisponivel, naoFoiAmostrado } from "../perception";
import type { RegistroCiclo, ResultadoCiclo } from "./tipos";

/** Deriva o registro persistido a partir do resultado do ciclo (funcao pura). */
export function criarRegistroCiclo(
  resultado: ResultadoCiclo,
  opcoes: { registroEm?: string } = {}
): RegistroCiclo {
  const { pacote } = resultado;
  const indisponiveis = new Set<ResultadoIndisponivel["subsistema"]>();
  for (const observacao of pacote.observacoes) {
    for (const subsistema of [observacao.deteccoes, observacao.pose, observacao.maos, observacao.nsfw]) {
      // Pular um frame por cadencia nao e indisponibilidade: o subsistema nao
      // falhou e sera executado de novo no proximo alvo.
      if (estaIndisponivel(subsistema) && !naoFoiAmostrado(subsistema)) {
        indisponiveis.add(subsistema.subsistema);
      }
    }
  }
  return {
    sessionId: pacote.sessionId,
    cycleId: pacote.cycleId,
    iniciadoEm: pacote.iniciadoEm,
    concluidoEm: pacote.concluidoEm,
    frameIds: pacote.observacoes.map((observacao) => observacao.frameId),
    observacoes: pacote.observacoes.length,
    eventosTemporais: pacote.eventosTemporais.length,
    subsistemasIndisponiveis: [...indisponiveis],
    erros: resultado.erros,
    metricas: pacote.metricas,
    interpretacao: resultado.interpretacao,
    politica: pacote.politica,
    configuracao: pacote.configuracao,
    cancelado: resultado.cancelado,
    registroEm: opcoes.registroEm ?? new Date().toISOString(),
  };
}
