/**
 * Regras puras e vocabulário único da política de interpretação multimodal
 * (Fase 6, item 1).
 *
 * Os dois caminhos existentes — `PoliticaAnalise` (modo leve/Eventos, com
 * cooldown e janela deslizante) e `decidirInterpretacao` (ciclo multiframe,
 * sem estado) — produzem decisões diferentes apenas pelo estado. Aqui ficam o
 * modo, os tipos relevantes e os motivos canônicos compartilhados, para que
 * nenhum dos dois crie um vocabulário concorrente. A derivação continua pura:
 * timestamps e estado são injetados pelo chamador.
 */
import type { FrequenciaInterpretacao, MotivoSupressaoInterpretacao, ResumoTemporal } from "./cycle";
import type { TipoEventoTemporal } from "./temporal-event";

/** Modos canônicos — reutilizam o contrato já existente do ciclo. */
export type ModoPoliticaMultimodal = FrequenciaInterpretacao;

/**
 * Modo desejável para monitoramento **após validação com clipes anotados**
 * (plano mestre §8.1). Enquanto não há essa validação, o modo operacional
 * continua `sob_demanda`; nada aqui afirma que a política foi validada.
 */
export const MODO_DESEJADO_MONITORAMENTO: ModoPoliticaMultimodal = "quando_evento_relevante";

/** Motivos canônicos, comuns ao modo leve e ao ciclo multiframe. */
export type MotivoAtivacaoMultimodal =
  | "primeira_analise"
  | "mudanca_de_cena"
  | "nova_entidade"
  | "desaparecimento"
  | "movimento"
  | "baixa_confianca"
  | "resumo_periodico"
  | "manual"
  | "falha_percepcao"
  | "evento_relevante"
  | "interpretacao_continua"
  | "cooldown"
  | "limite_janela"
  | MotivoSupressaoInterpretacao
  | "sem_acao";

/**
 * Tipos que sustentam uma nova interpretação. `provavel` conta (evidência
 * sustentada, mas sem certeza); `incerto`/`candidato` não contam — um sinal
 * ainda não sustentado não deve acionar o modelo. A lista é a mesma usada pelo
 * ciclo; a reexportação abaixo evita duas definições divergentes.
 */
export const TIPOS_EVENTO_RELEVANTES_MULTIMODAL: readonly TipoEventoTemporal[] = [
  "aparicao",
  "desaparecimento",
  "mudanca_de_cena",
  "gesto_detectado",
  "braco_levantado",
  "transicao_acao",
  "movimento_corporal",
  "pose_compativel_sexual",
  "interacao_objeto",
];

/** IDs de eventos do resumo que justificam a interpretação. */
export function eventosRelevantesParaMultimodal(resumo: ResumoTemporal): string[] {
  return resumo.eventos
    .filter(
      (evento) =>
        TIPOS_EVENTO_RELEVANTES_MULTIMODAL.includes(evento.tipo) &&
        (evento.estado === "provavel" ||
          evento.estado === "confirmado" ||
          evento.estado === "encerrado")
    )
    .map((evento) => evento.eventoId);
}

export interface DecisaoAtivacaoMultimodal {
  interpretar: boolean;
  /** Preenchido somente quando a chamada é suprimida. */
  motivo?: MotivoSupressaoInterpretacao;
  /** Motivo canônico da decisão, inclusive para supressão e limites. */
  motivoAtivacao: MotivoAtivacaoMultimodal;
  /** Eventos que sustentaram a decisão; vazia quando suprimida. */
  eventosRelevantes: string[];
}

/**
 * Decide a etapa multimodal de forma pura. Não há relógio, IO ou efeito: o
 * chamador fornece o resumo e a intenção manual. `a_cada_ciclo` existe para
 * benchmark/diagnóstico; `sob_demanda` exige pedido explícito; e
 * `quando_evento_relevante` exige evento sustentado.
 */
export function decidirAtivacaoMultimodal(
  modo: ModoPoliticaMultimodal,
  resumo: ResumoTemporal,
  opcoes: { disparoManual?: boolean } = {}
): DecisaoAtivacaoMultimodal {
  const eventosRelevantes = eventosRelevantesParaMultimodal(resumo);
  switch (modo) {
    case "a_cada_ciclo":
      return { interpretar: true, motivoAtivacao: "interpretacao_continua", eventosRelevantes };
    case "sob_demanda":
      return opcoes.disparoManual
        ? { interpretar: true, motivoAtivacao: "manual", eventosRelevantes }
        : {
            interpretar: false,
            motivo: "politica_sob_demanda",
            motivoAtivacao: "politica_sob_demanda",
            eventosRelevantes: [],
          };
    case "quando_evento_relevante":
      return eventosRelevantes.length > 0
        ? { interpretar: true, motivoAtivacao: "evento_relevante", eventosRelevantes }
        : {
            interpretar: false,
            motivo: "sem_evento_relevante",
            motivoAtivacao: "sem_evento_relevante",
            eventosRelevantes: [],
          };
  }
}

/** Rótulo legível para telemetria/UI, sem alterar o motivo bruto. */
export function rotuloAtivacaoMultimodal(motivo: MotivoAtivacaoMultimodal): string {
  const rotulos: Record<MotivoAtivacaoMultimodal, string> = {
    primeira_analise: "primeira análise",
    mudanca_de_cena: "mudança de cena",
    nova_entidade: "nova entidade",
    desaparecimento: "desaparecimento",
    movimento: "movimento",
    baixa_confianca: "baixa confiança",
    resumo_periodico: "resumo periódico",
    manual: "manual",
    falha_percepcao: "falha na percepção",
    evento_relevante: "evento relevante",
    interpretacao_continua: "contínuo (diagnóstico)",
    cooldown: "cooldown",
    limite_janela: "limite por janela",
    politica_sob_demanda: "sob demanda",
    sem_evento_relevante: "sem evento relevante",
    sem_acao: "sem ação",
  };
  return rotulos[motivo];
}
