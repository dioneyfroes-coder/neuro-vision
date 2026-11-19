/**
 * Controlador da sessão de monitoramento no cliente (Fase 3).
 *
 * Mantém a gravação de bytes independente do ciclo de análise: um tick leve
 * reporta instantes de captura ao índice do servidor e, quando o servidor
 * informa um `segmentoId` novo, o gravador é rotacionado — o blob do segmento
 * que termina é enviado com o **id antigo** e um gravador novo começa. Nenhuma
 * função lê o relógio diretamente: relógio, fábrica do gravador, API e
 * agendador são injetados, para testes determinísticos.
 */

export type {
  ApiMonitoramentoCliente,
  UploadPendente,
  EstadoMonitoramento,
  DependenciasMonitoramento,
} from "./controlador-monitoramento/tipos";
export { ControladorMonitoramento } from "./controlador-monitoramento/controlador";
