import type { EventoTemporal, OrigemSinalTemporal } from "../../../src/domain";
import type { EstadoPar } from "./tipos";

export function eventoDe(par: EstadoPar, estado: "incerto" | "provavel" | "confirmado" | "encerrado"): EventoTemporal {
    const descricao =
      estado === "confirmado"
        ? `Contato confirmado entre mao e${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} (sobreposicao sustentada e mudanca de estado observada)`
        : estado === "provavel"
          ? `Provavel interacao com${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} (proximidade sustentada; contato nao confirmado)`
          : estado === "incerto"
            ? `Proximidade entre mao e${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} observada; contato nao confirmado`
            : `Interacao encerrada (grau maximo: ${par.grauMaximo})`;
    return {
      eventoId: par.eventoId,
      sessionId: par.sessionId,
      cycleId: par.cycleIdInicio,
      tipo: "interacao_objeto",
      inicioEm: par.inicioEm,
      fimEm: estado === "encerrado" ? par.ultimaEvidenciaEm : undefined,
      ultimaEvidenciaEm: par.ultimaEvidenciaEm,
      ultimaObservacaoEm: par.ultimaObservacaoEm,
      entidadeId: par.objetoEntidadeId,
      participantes: [par.maoEntidadeId, par.objetoEntidadeId],
      rotuloObjeto: par.rotuloObjeto,
      descricao,
      confianca: par.confianca,
      origens: ["maos", "objetos"] as OrigemSinalTemporal[],
      frameIds: [...par.frameIds],
      estado,
      motivoEncerramento: estado === "encerrado" ? "sem_sinal" : undefined,
      continuidadeValida: par.continuidadeValida,
      evidencias: [...par.evidencias, `grau:${par.grauMaximo}`],
    };
  }

export function adicionarFrame(frames: string[], frameId: string | undefined): void {
    if (!frameId) return;
    if (frames[frames.length - 1] !== frameId) frames.push(frameId);
  }

export function adicionarEvidencia(evidencias: string[], evidencia: string): void {
    if (evidencias.includes(evidencia)) return;
    if (evidencias.length >= 12) return;
    evidencias.push(evidencia);
  }
