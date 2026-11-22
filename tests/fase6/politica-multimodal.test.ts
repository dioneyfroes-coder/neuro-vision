import { describe, expect, it } from "vitest";
import {
  decidirAtivacaoMultimodal,
  eventosRelevantesParaMultimodal,
  MODO_DESEJADO_MONITORAMENTO,
} from "../../src/domain/politica-multimodal";
import { decidirInterpretacao } from "../../public/cycle/politica-ciclo";
import type { EventoTemporal, ResumoTemporal } from "../../src/domain";

function resumoCom(
  estado: EventoTemporal["estado"],
  tipo: EventoTemporal["tipo"] = "aparicao"
): ResumoTemporal {
  return {
    eventos: [
      {
        eventoId: "ev1",
        sessionId: "s1",
        tipo,
        inicioEm: "2026-11-22T12:00:00.000Z",
        descricao: "sinal",
        estado,
      } as EventoTemporal,
    ],
    tracksAtivos: 0,
    pessoasAtivas: 0,
    maosAtivas: 0,
    objetosAtivos: 0,
  };
}

describe("política multimodal orientada a eventos (Fase 6, item 1)", () => {
  it("usa o mesmo modo desejável declarado no plano, sem afirmar validação", () => {
    expect(MODO_DESEJADO_MONITORAMENTO).toBe("quando_evento_relevante");
  });

  it("só considera eventos sustentados como relevante", () => {
    expect(eventosRelevantesParaMultimodal(resumoCom("provavel"))).toEqual(["ev1"]);
    expect(eventosRelevantesParaMultimodal(resumoCom("confirmado"))).toEqual(["ev1"]);
    expect(eventosRelevantesParaMultimodal(resumoCom("candidato"))).toEqual([]);
    expect(eventosRelevantesParaMultimodal(resumoCom("incerto"))).toEqual([]);
  });

  it("não trata lacuna de observação como evento relevante", () => {
    const resumo = resumoCom("confirmado", "desaparecimento");
    resumo.eventos[0].motivoEncerramento = "periodo_cego";
    expect(decidirAtivacaoMultimodal("quando_evento_relevante", resumo).interpretar).toBe(true);
    expect(decidirAtivacaoMultimodal("quando_evento_relevante", resumoCom("incerto")).interpretar).toBe(false);
  });

  it("mantém os três modos e o vocabulário de supressão existentes", () => {
    const resumo = resumoCom("confirmado");
    expect(decidirAtivacaoMultimodal("a_cada_ciclo", resumo)).toMatchObject({
      interpretar: true,
      motivoAtivacao: "interpretacao_continua",
    });
    expect(decidirAtivacaoMultimodal("sob_demanda", resumo)).toMatchObject({
      interpretar: false,
      motivo: "politica_sob_demanda",
    });
    expect(decidirAtivacaoMultimodal("sob_demanda", resumo, { disparoManual: true })).toMatchObject({
      interpretar: true,
      motivoAtivacao: "manual",
    });
    expect(decidirAtivacaoMultimodal("quando_evento_relevante", resumoCom("candidato"))).toMatchObject({
      interpretar: false,
      motivo: "sem_evento_relevante",
    });
  });

  it("preserva o contrato antigo de decidirInterpretacao", () => {
    const politica = { interpretacao: "quando_evento_relevante" } as Parameters<
      typeof decidirInterpretacao
    >[0];
    expect(decidirInterpretacao(politica, resumoCom("provavel"))).toEqual({
      interpretar: true,
      eventosRelevantes: ["ev1"],
    });
    expect(decidirInterpretacao(politica, resumoCom("incerto"))).toEqual({
      interpretar: false,
      motivo: "sem_evento_relevante",
      eventosRelevantes: [],
    });
  });
});
