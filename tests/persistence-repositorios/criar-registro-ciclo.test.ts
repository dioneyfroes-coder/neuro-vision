import { describe, expect, it } from "vitest";
import { criarRegistroCiclo } from "../../src/domain/cycle";
import { naoAmostrado } from "../../src/domain/perception";
import { observacao, resultadoCiclo } from "../helpers/persistence-repositorios";

describe("criarRegistroCiclo", () => {
  it("preserva as relacoes entre sessao, frames e eventos do ciclo", () => {
    const registro = criarRegistroCiclo(
      resultadoCiclo([observacao("f1", true), observacao("f2")]),
      { registroEm: "2026-10-17T12:00:02.000Z" }
    );
    expect(registro).toMatchObject({
      sessionId: "sessao-1",
      cycleId: "sessao-1-c1",
      frameIds: ["f1", "f2"],
      observacoes: 2,
      eventosTemporais: 0,
      subsistemasIndisponiveis: ["pose"],
      cancelado: false,
      registroEm: "2026-10-17T12:00:02.000Z",
    });
  });

  it("nao trata frame pulado pela cadencia como subsistema indisponivel", () => {
    const pulado = {
      ...observacao("f1"),
      pose: naoAmostrado("pose"),
      maos: naoAmostrado("maos"),
    };
    const registro = criarRegistroCiclo(resultadoCiclo([pulado]));
    expect(registro.subsistemasIndisponiveis).toEqual([]);
  });

  it("mantem o erro de etapa e o cancelamento no registro", () => {
    const registro = criarRegistroCiclo(
      resultadoCiclo([], {
        erros: [{ etapa: "multimodal", mensagem: "backend fora" }],
        cancelado: true,
      })
    );
    expect(registro.erros).toEqual([{ etapa: "multimodal", mensagem: "backend fora" }]);
    expect(registro.cancelado).toBe(true);
  });
});
