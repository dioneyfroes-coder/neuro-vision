import type { ResumoTemporal, TipoEventoTemporal } from "../../src/domain";

/**
 * Politica do ciclo multiframe (Fase 4).
 *
 * Separa explicitamente os tempos que antes viviam misturados num unico
 * "intervalo":
 * - `intervaloEntreSnapshotsMs`: espacamento entre os snapshots **dentro** de um ciclo;
 * - `quantidadeSnapshots`: quantos snapshots compoem a janela do ciclo;
 * - `pausaAposCicloMs`: descanso apos a **conclusao efetiva** do ciclo (nao e
 *   intervalo entre inicios — nao se aplica apenas quando ha folga);
 * - `interpretacao`: quando a etapa multimodal e chamada.
 *
 * O agendador usa `pausaAposCicloMs` como piso: o proximo ciclo so comeca
 * depois de a pausa transcorrer contada do **fim** do ciclo anterior, ainda que
 * a duracao do ciclo seja maior que o intervalo entre inicios.
 */
export interface PoliticaCiclo {
  /** Intervalo entre snapshots dentro do ciclo (ms). Padrao: 500. */
  intervaloEntreSnapshotsMs: number;
  /** Quantidade de snapshots por ciclo. Padrao: 4. */
  quantidadeSnapshots: number;
  /** Descanso apos a conclusao efetiva do ciclo (ms). Padrao: 6000. */
  pausaAposCicloMs: number;
  /**
   * Frequencia da interpretacao multimodal:
   * - `a_cada_ciclo`: interpreta sempre (linha de base);
   * - `sob_demanda`: so quando a UI pede (ciclo disparado manualmente);
   * - `quando_evento_relevante`: so quando o motor temporal produziu evento
   *   relevante no ciclo — permite medir a variante com supressao.
   */
  interpretacao: FrequenciaInterpretacao;
}

/** Quando a etapa multimodal e chamada. */
export type FrequenciaInterpretacao = "a_cada_ciclo" | "sob_demanda" | "quando_evento_relevante";

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

export const POLITICA_CICLO_PADRAO: PoliticaCiclo = {
  // 500 ms entre snapshots: encurta a janela do ciclo (~1,5 s de captura em vez
  // de ~3 s) sem deixar de amostrar vários instantes. Ajustável por modo.
  intervaloEntreSnapshotsMs: 500,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  interpretacao: "a_cada_ciclo",
};

/** Motivo pelo qual uma interpretacao foi suprimida (registrado no ciclo). */
export type MotivoSupressaoInterpretacao =
  | "politica_sob_demanda"
  | "sem_evento_relevante";

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
  politica: PoliticaCiclo,
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
