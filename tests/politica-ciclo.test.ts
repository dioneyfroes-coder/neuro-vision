import { describe, expect, it } from "vitest";
import type { EventoTemporal, ResumoTemporal } from "../src/domain";
import {
  decidirInterpretacao,
  eventosRelevantes,
  POLITICA_CICLO_PADRAO,
  TIPOS_EVENTO_RELEVANTES,
} from "../public/cycle/politica-ciclo";
import type { PoliticaCiclo } from "../public/cycle/politica-ciclo";

/**
 * Fase 4 — politica do ciclo.
 *
 * Verifica a separacao dos tempos (snapshots vs pausa pos-ciclo), a decisao de
 * interpretar com motivo explicito e a definicao de "mudanca relevante".
 */

function evento(
  parcial: Partial<EventoTemporal> & Pick<EventoTemporal, "tipo" | "estado">
): EventoTemporal {
  return {
    eventoId: parcial.eventoId ?? "e1",
    sessionId: "s1",
    tipo: parcial.tipo,
    inicioEm: "2026-10-17T12:00:00.000Z",
    descricao: "evento",
    origens: ["objetos"],
    frameIds: ["f1"],
    estado: parcial.estado,
    ...parcial,
  };
}

function resumo(eventos: EventoTemporal[]): ResumoTemporal {
  return { eventos, entidadesAtivas: 1 };
}

describe("POLITICA_CICLO_PADRAO", () => {
  it("separa intervalo entre snapshots, quantidade, pausa e frequencia", () => {
    expect(POLITICA_CICLO_PADRAO).toEqual({
      intervaloEntreSnapshotsMs: 500,
      quantidadeSnapshots: 4,
      pausaAposCicloMs: 6000,
      interpretacao: "a_cada_ciclo",
    });
  });
});

describe("eventosRelevantes", () => {
  it("conta apenas tipos relevantes em estado confirmado/encerrado", () => {
    const r = resumo([
      evento({ eventoId: "e1", tipo: "aparicao", estado: "confirmado" }),
      evento({ eventoId: "e2", tipo: "gesto_detectado", estado: "encerrado" }),
      // candidato: ainda nao sustentado
      evento({ eventoId: "e3", tipo: "mudanca_de_cena", estado: "candidato" }),
      // incerto: interrompido por lacuna, nao por ausencia observada
      evento({ eventoId: "e4", tipo: "desaparecimento", estado: "incerto" }),
    ]);
    expect(eventosRelevantes(r)).toEqual(["e1", "e2"]);
  });

  it("trata todos os tipos relevantes declarados", () => {
    const r = resumo(
      TIPOS_EVENTO_RELEVANTES.map((tipo, i) =>
        evento({ eventoId: `e${i}`, tipo, estado: "confirmado" })
      )
    );
    expect(eventosRelevantes(r)).toHaveLength(TIPOS_EVENTO_RELEVANTES.length);
  });
});

describe("decidirInterpretacao", () => {
  const comEvento = resumo([evento({ tipo: "aparicao", estado: "confirmado" })]);
  const semEvento = resumo([
    evento({ tipo: "aparicao", estado: "candidato" }),
  ]);

  it("a_cada_ciclo interpreta sempre, mesmo sem evento relevante", () => {
    const politica: PoliticaCiclo = POLITICA_CICLO_PADRAO;
    expect(decidirInterpretacao(politica, semEvento)).toMatchObject({ interpretar: true });
    expect(decidirInterpretacao(politica, comEvento).interpretar).toBe(true);
  });

  it("sob_demanda so interpreta em ciclo pedido pela UI, com motivo quando suprime", () => {
    const politica: PoliticaCiclo = { ...POLITICA_CICLO_PADRAO, interpretacao: "sob_demanda" };
    expect(decidirInterpretacao(politica, comEvento)).toEqual({
      interpretar: false,
      motivo: "politica_sob_demanda",
      eventosRelevantes: [],
    });
    expect(decidirInterpretacao(politica, comEvento, { disparoManual: true }).interpretar).toBe(
      true
    );
  });

  it("quando_evento_relevante suprime ciclos sem mudanca relevante", () => {
    const politica: PoliticaCiclo = {
      ...POLITICA_CICLO_PADRAO,
      interpretacao: "quando_evento_relevante",
    };
    expect(decidirInterpretacao(politica, semEvento)).toEqual({
      interpretar: false,
      motivo: "sem_evento_relevante",
      eventosRelevantes: [],
    });
    const decisao = decidirInterpretacao(politica, comEvento);
    expect(decisao.interpretar).toBe(true);
    expect(decisao.eventosRelevantes).toEqual(["e1"]);
    expect(decisao.motivo).toBeUndefined();
  });
});
