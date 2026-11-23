import { describe, expect, it } from "vitest";
import {
  partesDiagnosticoPersistencia,
  textoAvisoPersistencia,
} from "../public/ui/diagnostico-persistencia";
import type { EstadoFila } from "../public/persistencia";

function estado(parcial: Partial<EstadoFila> = {}): EstadoFila {
  return { enviados: 0, falhas: 0, pendentes: 0, descartes: 0, ...parcial };
}

describe("diagnostico da fila de persistencia", () => {
  it("nao inventa aviso quando nada falhou", () => {
    expect(partesDiagnosticoPersistencia(estado())).toEqual([]);
    expect(textoAvisoPersistencia(estado())).toBeNull();
  });

  it("mostra pendencias, falhas e descartes como fatos separados", () => {
    const partes = partesDiagnosticoPersistencia(
      estado({ pendentes: 2, falhas: 3, descartes: 1 })
    );
    expect(partes).toEqual(["fila 2", "falhas de persistencia 3", "descartes da fila 1"]);
  });

  it("torna visivel o descarte por limite mesmo sem falhas restantes", () => {
    const aviso = textoAvisoPersistencia(
      estado({ descartes: 2, ultimoErro: "fila cheia: descartado evento:aparicao" })
    );
    expect(aviso).toContain("2 descartado(s) por limite");
    expect(aviso).toContain("fila cheia: descartado evento:aparicao");
    expect(aviso).not.toContain(" gravado com sucesso");
  });

  it("inclui o ultimo erro sem apagar a contagem de falhas", () => {
    const aviso = textoAvisoPersistencia(estado({ falhas: 1, ultimoErro: "sem servidor" }));
    expect(aviso).toContain("1 gravacao(oes) nao chegaram ao servidor");
    expect(aviso).toContain("sem servidor");
  });
});
