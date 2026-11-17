/**
 * Adaptador HTTP do controlador de monitoramento (Fase 3).
 *
 * Liga a interface injetável `ApiMonitoramentoCliente` às funções de `api.ts`,
 * mantendo o controlador livre de `fetch`. O relógio continua sendo informado
 * pelo chamador: `pausar`/`retomar` não aceitam instante e o servidor usa o
 * dele, enquanto `iniciar`/`encerrar`/`interromper` recebem `agoraMs`.
 */
import {
  encerrarMonitoramento,
  enviarQuadrosMonitoramento,
  enviarVideoSegmento,
  iniciarMonitoramento,
  interromperMonitoramento,
  pausarMonitoramento,
  retomarMonitoramento,
} from "../api";
import type { ApiMonitoramentoCliente } from "./controlador-monitoramento";

export const apiMonitoramentoCliente: ApiMonitoramentoCliente = {
  iniciar: (opcoes) => iniciarMonitoramento(opcoes),
  enviarQuadros: (quadros) => enviarQuadrosMonitoramento(quadros),
  pausar: (sessaoId) => pausarMonitoramento(sessaoId),
  retomar: (sessaoId) => retomarMonitoramento(sessaoId),
  encerrar: (sessaoId, agoraMs) => encerrarMonitoramento(sessaoId, agoraMs),
  interromper: (sessaoId, agoraMs, motivo) => interromperMonitoramento(sessaoId, agoraMs, motivo),
  enviarVideo: (opcoes) => enviarVideoSegmento(opcoes),
};
