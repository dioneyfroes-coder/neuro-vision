/**
 * Detector de interacoes mão↔objeto (Fase 4, itens 5–7) — regra pura.
 *
 * O ponto central deste modulo e a barra de evidencia:
 *
 * - **proximidade não é contato.** Aproximar a mao de um objeto, mesmo por
 *   varios frames, no maximo sustenta um evento `provavel`;
 * - **contato confirmado** exige sobreposicao sustentada do punho com a caixa
 *   do objeto **e** uma mudanca de estado do objeto observada no mesmo periodo
 *   (o objeto se deslocou com intervalo temporal valido). Sem essa corroboracao
 *   o evento fica `provavel`, com a descricao explicando o que falta;
 * - evidencia fraca, curta ou com continuidade invalida gera `incerto`, nunca
 *   uma conclusao de contato;
 * - o fim do evento e sempre a **ultima evidencia positiva**, e a identificacao
 *   (`eventoId`) e estavel entre os graus e o encerramento.
 *
 * Nenhuma funcao le relogio, DOM ou API de navegador: o tempo vem de
 * `timestamp`/`tempoMs` da amostra, para testes deterministicos.
 */

export type {
  GrauInteracao,
  CaixaNormalizada,
  AmostraInteracao,
  ConfigInteracao,
  OpcoesProcessarInteracao,
} from "./interacao/tipos";
export { CONFIG_INTERACAO_PADRAO } from "./interacao/tipos";
export { DetectorInteracao } from "./interacao/processamento";
