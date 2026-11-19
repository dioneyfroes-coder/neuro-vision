import { describe, expect, it } from "vitest";
import { executarCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import { evento, fonteVazia, motorTemporalFalso, montar, processamento } from "../helpers/ciclo-multiframe";

describe("executarCicloMultiframe — motor temporal e encerramento do ciclo", () => {
  it("liga o motor temporal: consome as observacoes e alimenta o pacote", async () => {
    const { deps } = montar();
    const vistos: ObservacaoFrame[][] = [];
    deps.motorTemporal = motorTemporalFalso(vistos);

    const resultado = await executarCicloMultiframe(deps);

    // O motor recebeu exatamente as observacoes do ciclo, na ordem.
    expect(vistos).toHaveLength(1);
    expect(vistos[0].map((o) => o.frameId)).toEqual([
      "sess0001-c1-f0",
      "sess0001-c1-f1",
      "sess0001-c1-f2",
      "sess0001-c1-f3",
    ]);
    // O resumo temporal entra no pacote (eventos + leitura consolidada).
    expect(resultado.pacote.eventosTemporais).toEqual([evento(1)]);
    expect(resultado.pacote.resumoTemporal).toEqual({
      eventos: [evento(1)],
      tracksAtivos: 1,
      pessoasAtivas: 1,
      maosAtivas: 0,
      objetosAtivos: 0,
    });
    expect(typeof resultado.pacote.metricas.temporalMs).toBe("number");
    expect(resultado.erros).toHaveLength(0);
  });

  it("falha do motor temporal vira erro de etapa sem derrubar a interpretacao", async () => {
    const { deps } = montar();
    deps.motorTemporal = motorTemporalFalso([], () => {
      throw new Error("motor temporal quebrou");
    });

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.erros).toContainEqual({
      etapa: "temporal",
      mensagem: "motor temporal quebrou",
    });
    expect(resultado.pacote.eventosTemporais).toEqual([]);
    expect(resultado.pacote.resumoTemporal).toEqual({
      eventos: [],
      tracksAtivos: 0,
      pessoasAtivas: 0,
      maosAtivas: 0,
      objetosAtivos: 0,
    });
    // O ciclo segue: a interpretacao multimodal ainda acontece.
    expect(resultado.interpretacao).toBe("quatro frames analisados");
  });

  it("sem frame disponivel nao interpreta nem persiste (nao e falha)", async () => {
    const { deps, interpretados } = montar({ fonte: fonteVazia() });
    const registros: RegistroCiclo[] = [];
    deps.persistirCiclo = (registro) => {
      registros.push(registro);
    };

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.pacote.observacoes).toHaveLength(0);
    expect(resultado.interpretacao).toBeUndefined();
    expect(resultado.cancelado).toBe(false);
    expect(interpretados).toHaveLength(0);
    expect(registros).toHaveLength(0);
  });

  it("registra concluidoEm no fim, depois da interpretacao e da persistencia", async () => {
    const ordem: string[] = [];
    const { deps } = montar({
      processarFrame: async () => {
        ordem.push("percepcao");
        return processamento();
      },
    });
    deps.agoraIso = () => "2026-10-16T10:00:00.000Z";
    deps.interpretador = {
      modelo: "m",
      interpretar: async (): Promise<ResultadoInterpretacao> => {
        ordem.push("interpretacao");
        return {
          resumo: "x",
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 5,
        };
      },
    };
    deps.persistirCiclo = () => {
      ordem.push("persistencia");
    };

    const resultado = await executarCicloMultiframe(deps);
    ordem.push("retorno");

    // A ordem do ciclo e captura -> percepcao -> interpretacao -> persistencia.
    expect(ordem.indexOf("interpretacao")).toBeLessThan(ordem.indexOf("persistencia"));
    expect(ordem.indexOf("persistencia")).toBeLessThan(ordem.indexOf("retorno"));
    // concluidoEm so existe depois de tudo: o pacote terminou.
    expect(resultado.pacote.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
    expect(resultado.pacote.metricas.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
  });

  it("entrega concluidoEm ao registro persistido (JSONL nunca fica sem ele)", async () => {
    const { deps } = montar();
    let persistido: RegistroCiclo | undefined;
    deps.persistirCiclo = (registro) => {
      persistido = registro;
    };

    const resultado = await executarCicloMultiframe(deps);

    expect(persistido?.concluidoEm).toBeTruthy();
    expect(resultado.pacote.concluidoEm).toBeTruthy();
  });

  it("registra timestamps por etapa (item 4)", async () => {
    const { deps } = montar();
    deps.motorTemporal = motorTemporalFalso([]);
    const resultado = await executarCicloMultiframe(deps);
    const m = resultado.pacote.metricas;

    expect(m.capturaConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.percepcaoConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.temporalConcluidoEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.interpretacaoConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.persistenciaConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
  });

});