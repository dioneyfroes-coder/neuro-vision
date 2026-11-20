import type { DiagnosticoSinalTemporal, EventoTemporal } from "../../temporal-event";

/** Leitura consolidada do motor temporal para um ciclo. */
export interface ResumoTemporal {
  /** Eventos ativos/encerrados neste ciclo (com identidade unica). */
  eventos: EventoTemporal[];
  /**
   * Tracks vivos no fim do ciclo: **soma** de pessoas, maos e objetos
   * rastreados. Nao e a quantidade de entidades fisicas distintas — uma mesma
   * pessoa pode contribuir com o track de pose e com um ou dois tracks de mao.
   * Use a decomposicao abaixo quando o numero precisar de significado fisico.
   */
  tracksAtivos: number;
  /** Tracks de pessoas (pose) vivos no fim do ciclo. */
  pessoasAtivas: number;
  /** Tracks de maos vivos no fim do ciclo. */
  maosAtivas: number;
  /** Tracks de objetos vivos no fim do ciclo. */
  objetosAtivos: number;
  /** Texto curto consolidado, quando o motor produz um. */
  descricao?: string;
  /**
   * Estados correntes dos sinais temporais (confirmado, ocluido, inferencia
   * indisponivel, observacao insuficiente). Permite diagnosticar o que nao
   * virou evento sem confundir falha, oclusao e ausencia de sinal.
   */
  diagnosticos?: DiagnosticoSinalTemporal[];
  /** Sinal de que faltaram observacoes (janela cega anterior ao ciclo). */
  houveIntervaloSemObservacao?: boolean;
  /**
   * Duracao (ms) do periodo cego anterior a este ciclo, quando detectado.
   * Explicita a lacuna: eventos em curso foram interrompidos no ultimo instante
   * de evidencia, sem presuncao de continuidade.
   */
  intervaloSemObservacaoMs?: number;
}
