import type { ResumoTemporal, TipoEventoTemporal } from "../../src/domain";
import type {
  FrequenciaInterpretacao,
  FinalidadePoliticaCiclo,
  MotivoSupressaoInterpretacao,
  PoliticaCicloAplicada,
} from "../../src/domain/cycle";

export type { FrequenciaInterpretacao, MotivoSupressaoInterpretacao } from "../../src/domain/cycle";

/**
 * Politica do ciclo multiframe (Fase 4).
 *
 * Separa explicitamente os tempos que antes viviam misturados num unico
 * "intervalo":
 * - `intervaloEntreSnapshotsMs`: espacamento entre os snapshots **dentro** de um ciclo;
 * - `quantidadeSnapshots`: quantos snapshots compoem a janela do ciclo;
 * - `pausaAposCicloMs`: descanso apos a **conclusao efetiva** do ciclo (contado
 *   do fim, nao e intervalo entre inicios);
 * - `interpretacao`: quando a etapa multimodal e chamada.
 */
export interface PoliticaCiclo {
  /** Identificador estavel da politica (ex.: `benchmark-500ms`). */
  id: string;
  finalidade: FinalidadePoliticaCiclo;
  /** Rotulo legivel (ex.: `500ms`, `1s`). */
  referencia: string;
  /** Intervalo entre snapshots dentro do ciclo (ms). */
  intervaloEntreSnapshotsMs: number;
  /** Quantidade de snapshots por ciclo. */
  quantidadeSnapshots: number;
  /** Descanso apos a conclusao efetiva do ciclo (ms). */
  pausaAposCicloMs: number;
  /** Frequencia da interpretacao multimodal. */
  interpretacao: FrequenciaInterpretacao;
}

/**
 * Tipos de evento considerados "relevantes" para justificar uma nova
 * interpretacao: mudancas de cena/entidades e gestos/posturas que o modelo
 * precisa narrar. Estados nao confirmados (`candidato`) e eventos apenas
 * interrompidos por lacuna (`incerto`) **nao** contam — evita chamar o modelo
 * por um sinal ainda nao sustentado por evidencia.
 */
export const TIPOS_EVENTO_RELEVANTES: readonly TipoEventoTemporal[] = [
  "aparicao",
  "desaparecimento",
  "mudanca_de_cena",
  "gesto_detectado",
  "braco_levantado",
  "movimento_corporal",
];

/** Politica padrao do modo operacional (producao/uso real). */
export const POLITICA_CICLO_OPERACIONAL: PoliticaCiclo = {
  id: "operacional-500ms",
  finalidade: "operacional",
  referencia: "500ms",
  // 500 ms entre snapshots, janela nominal ~1,5 s (0,500,1000,1500).
  intervaloEntreSnapshotsMs: 500,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  // Sem dados locais confiaveis o suficiente ainda: manter sob demanda ou por
  // evento relevante em operacao; o benchmark define sua propria politica.
  interpretacao: "sob_demanda",
};

/** Politica de benchmark alvo (variantes multiframe): 1s entre snapshots. */
export const POLITICA_CICLO_BENCHMARK_ALVO: PoliticaCiclo = {
  id: "benchmark-1s",
  finalidade: "benchmark",
  referencia: "1s",
  // Plano original: 1 snapshot por segundo, 4 snapshots = janela ~3 s.
  intervaloEntreSnapshotsMs: 1000,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  // Medido explicitamente como variante experimental/caro.
  interpretacao: "a_cada_ciclo",
};

/** Politica alternativa (500ms) para comparar latencia vs janela temporal. */
export const POLITICA_CICLO_BENCHMARK_RAPIDO: PoliticaCiclo = {
  id: "benchmark-500ms",
  finalidade: "benchmark",
  referencia: "500ms",
  intervaloEntreSnapshotsMs: 500,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  interpretacao: "a_cada_ciclo",
};

/**
 * Politica padrao mantida para compatibilidade com codigo existente.
 * O modo operacional da interface deve passar explicitamente sua politica.
 */
export { POLITICA_CICLO_OPERACIONAL as POLITICA_CICLO_PADRAO_OPERACIONAL };

/**
 * Cria a representacao aplicada da politica para persistencia/metricas.
 * Usa a definicao completa quando disponivel, senao deriva os campos basicos.
 */
export function aplicarPolitica(
  politica: PoliticaCiclo | PoliticaCicloAplicada
): PoliticaCicloAplicada {
  if ("janelaNominalMs" in politica) return politica;
  const janelaNominalMs =
    politica.quantidadeSnapshots > 0
      ? politica.intervaloEntreSnapshotsMs * Math.max(0, politica.quantidadeSnapshots - 1)
      : 0;
  return { ...politica, janelaNominalMs };
}

/** Decisao da politica sobre a etapa multimodal, com motivo explicito. */
export interface DecisaoInterpretacao {
  /** `true` chama o modelo; `false` suprime a chamada. */
  interpretar: boolean;
  /** Motivo registrado quando a chamada e suprimida. */
  motivo?: MotivoSupressaoInterpretacao;
  /** Eventos relevantes que sustentaram a decisao (vazio quando suprimida). */
  eventosRelevantes: string[];
}

/** Eventos do resumo temporal que contam como "mudanca relevante". */
export function eventosRelevantes(resumo: ResumoTemporal): string[] {
  return resumo.eventos
    .filter(
      (evento) =>
        TIPOS_EVENTO_RELEVANTES.includes(evento.tipo) &&
        (evento.estado === "confirmado" || evento.estado === "encerrado")
    )
    .map((evento) => evento.eventoId);
}

/**
 * Decide se o ciclo deve chamar o modelo multimodal (item 5 da Fase 4). A
 * decisao e pura e sempre devolve o motivo quando suprime, para que o registro
 * do ciclo explique a ausencia da interpretacao. `disparoManual` representa um
 * ciclo pedido pela UI (`sob_demanda`).
 */
export function decidirInterpretacao(
  politica: PoliticaCiclo | PoliticaCicloAplicada,
  resumo: ResumoTemporal,
  opcoes: { disparoManual?: boolean } = {}
): DecisaoInterpretacao {
  switch (politica.interpretacao) {
    case "a_cada_ciclo":
      return { interpretar: true, eventosRelevantes: eventosRelevantes(resumo) };
    case "sob_demanda":
      return opcoes.disparoManual
        ? { interpretar: true, eventosRelevantes: eventosRelevantes(resumo) }
        : { interpretar: false, motivo: "politica_sob_demanda", eventosRelevantes: [] };
    case "quando_evento_relevante": {
      const relevantes = eventosRelevantes(resumo);
      return relevantes.length > 0
        ? { interpretar: true, eventosRelevantes: relevantes }
        : { interpretar: false, motivo: "sem_evento_relevante", eventosRelevantes: [] };
    }
  }
}
