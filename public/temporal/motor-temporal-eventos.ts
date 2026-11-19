import type {
  DiagnosticoSinalTemporal,
  EventoTemporal,
  OrigemSinalTemporal,
  SinalTemporalDiagnosticado,
  TipoEventoTemporal,
} from "../../src/domain";
import { uuid } from "../../src/domain/ids";
import type { EventoVisual } from "../../src/types";
import type { EventoSinal, MaquinaSinais } from "./maquina-sinais";

/**
 * Converte o estado corrente das maquinas em diagnostico, sem emitir evento.
 * `indisponivel` vence os demais estados: falha de inferencia nao e oclusao.
 */
export function registrarDiagnosticos(
  diagnosticos: Map<string, DiagnosticoSinalTemporal>,
  sinal: SinalTemporalDiagnosticado,
  maquina: MaquinaSinais,
  indisponivel: boolean
): void {
  for (const diag of maquina.diagnosticos()) {
    let estado: DiagnosticoSinalTemporal["estado"];
    if (indisponivel && (diag.ativo || diag.framesCandidato > 0)) {
      estado = "inferencia_indisponivel";
    } else if (diag.ativo && diag.framesSemSinal > 0 && diag.motivoUltimaAusencia === "oclusao") {
      estado = "ocluido";
    } else if (diag.ativo) {
      estado = "confirmado";
    } else if (diag.framesCandidato > 0) {
      estado = "observacao_insuficiente";
    } else if (diag.framesEvidencia > 0) {
      // Encerramento do processamento corrente: o evento existiu, mas nao ha
      // mais ativo/candidato. Nao e o mesmo que "nunca observado".
      estado = "encerrado";
    } else {
      continue;
    }
    diagnosticos.set(`${sinal}:${diag.entidadeId}`, {
      sinal,
      entidadeId: diag.entidadeId,
      estado,
      rotulo: diag.rotuloAtivo ?? diag.rotuloCandidato,
      confianca: diag.confianca,
      framesEvidencia: diag.framesEvidencia,
      framesSemSinal: diag.framesSemSinal,
      evidencias: diag.evidencias,
      continuidadeValida: diag.continuidadeValida,
      motivoEncerramento:
        estado === "ocluido" || estado === "encerrado"
          ? diag.motivoUltimaAusencia
          : undefined,
      ultimaEvidenciaEm: diag.ultimaEvidenciaEm,
      ultimaObservacaoEm: diag.ultimaObservacaoEm,
    });
  }
}

export function sinalParaEvento(
  sinal: EventoSinal,
  tipo: TipoEventoTemporal,
  origem: OrigemSinalTemporal,
  sessionId: string,
  descricao: (s: EventoSinal) => string
): EventoTemporal {
  // Um encerramento por periodo cego nao afirma que o sinal terminou: o fim e
  // apenas a ultima evidencia positiva e o estado fica `incerto` (nao vira
  // fato persistido). A duracao da lacuna vai no proprio evento.
  const interrompidoPorLacuna = sinal.motivoEncerramento === "periodo_cego";
  return {
    eventoId: sinal.eventoId,
    sessionId,
    cycleId: sinal.cycleIdInicio,
    tipo,
    inicioEm: sinal.inicioEm,
    fimEm: sinal.fimEm,
    ultimaEvidenciaEm: sinal.ultimaEvidenciaEm,
    ultimaObservacaoEm: sinal.ultimaObservacaoEm,
    entidadeId: sinal.entidadeId,
    descricao: descricao(sinal),
    confianca: sinal.confianca,
    origens: [origem],
    frameIds: sinal.frameIds,
    estado: interrompidoPorLacuna ? "incerto" : sinal.estado,
    intervaloSemObservacaoMs: sinal.intervaloSemObservacaoMs,
    motivoEncerramento: sinal.motivoEncerramento,
    continuidadeValida: sinal.continuidadeValida,
    evidencias: sinal.evidencias,
  };
}

export function converterEventoVisual(
  ev: EventoVisual,
  sessionId: string,
  frameId: string,
  cycleId: string
): EventoTemporal | null {
  const tipo = MAPEAMENTO_EVENTO_VISUAL[ev.tipo];
  if (!tipo) return null;
  const origem: OrigemSinalTemporal = ev.tipo === "mudanca_de_cena" ? "cena" : "objetos";
  return {
    eventoId: uuid(),
    sessionId,
    cycleId,
    tipo,
    inicioEm: ev.timestamp,
    // Eventos visuais nascem de uma observacao pontual: evidencia e
    // observacao coincidem no mesmo instante.
    ultimaEvidenciaEm: ev.timestamp,
    ultimaObservacaoEm: ev.timestamp,
    entidadeId: ev.objetoId,
    rotuloObjeto: ev.rotuloObjeto,
    descricao: ev.descricao,
    confianca: ev.confianca,
    origens: [origem],
    frameIds: frameId ? [frameId] : [],
    estado: "confirmado",
    // Evento visual e pontual: nao ha duracao sustentada para encerrar.
    motivoEncerramento: "ponto",
    continuidadeValida: true,
  };
}

const MAPEAMENTO_EVENTO_VISUAL: Partial<Record<EventoVisual["tipo"], TipoEventoTemporal>> = {
  aparicao: "aparicao",
  desaparecimento: "desaparecimento",
  movimento: "movimento_objeto",
  mudanca_de_cena: "mudanca_de_cena",
};
