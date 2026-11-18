import { describe, expect, it } from "vitest";
import {
  cadenciaParaModo,
  estadoInicialFrequenciaAdaptativa,
  reduzirFrequenciaAdaptativa,
  type ConfigFrequenciaAdaptativa,
} from "../src/domain/frequencia-adaptativa";

const config: ConfigFrequenciaAdaptativa = {
  cadenciaAtencao: { maosMs: 200, poseMs: 500 },
  framesParaEntrar: 1,
  framesParaSair: 2,
  manterAposUltimaEvidenciaMs: 1000,
};

const presente = (tempoMs: number) => ({
  tempoMs,
  pessoasAtivas: 1,
  entrouPessoa: true,
});
const ausente = (tempoMs: number) => ({ tempoMs, pessoasAtivas: 0, saiuPessoa: true });

describe("frequencia adaptativa (Fase 4, item 3)", () => {
  it("entra em atencao apos a histerese de entrada configurada", () => {
    const comDuas = { ...config, framesParaEntrar: 2 };
    let estado = estadoInicialFrequenciaAdaptativa();
    expect(estado.modo).toBe("base");

    estado = reduzirFrequenciaAdaptativa(estado, presente(0), comDuas);
    expect(estado.modo).toBe("base");
    expect(estado.framesPositivos).toBe(1);

    estado = reduzirFrequenciaAdaptativa(estado, presente(100), comDuas);
    expect(estado).toMatchObject({ modo: "atencao", framesPositivos: 2, ativacoes: 1 });
  });

  it("so volta a base apos frames sem pessoa E tempo desde a ultima evidencia", () => {
    let estado = reduzirFrequenciaAdaptativa(
      estadoInicialFrequenciaAdaptativa(),
      presente(0),
      config
    );
    expect(estado.modo).toBe("atencao");

    estado = reduzirFrequenciaAdaptativa(estado, ausente(200), config);
    expect(estado).toMatchObject({ modo: "atencao", framesSemPessoa: 1 });
    estado = reduzirFrequenciaAdaptativa(estado, ausente(600), config);
    expect(estado).toMatchObject({ modo: "atencao", framesSemPessoa: 2 });

    estado = reduzirFrequenciaAdaptativa(estado, ausente(1100), config);
    expect(estado).toMatchObject({
      modo: "base",
      framesSemPessoa: 0,
      ultimaEvidenciaMs: undefined,
    });

    // Um novo periodo de atencao volta a contar do zero.
    estado = reduzirFrequenciaAdaptativa(estado, presente(1200), config);
    expect(estado).toMatchObject({ modo: "atencao", ativacoes: 2, framesSemPessoa: 0 });
  });

  it("nao sai por oclusao curta seguida de nova evidencia", () => {
    let estado = reduzirFrequenciaAdaptativa(
      estadoInicialFrequenciaAdaptativa(),
      presente(0),
      config
    );
    estado = reduzirFrequenciaAdaptativa(estado, ausente(100), config);
    estado = reduzirFrequenciaAdaptativa(estado, presente(200), config);
    expect(estado).toMatchObject({
      modo: "atencao",
      framesSemPessoa: 0,
      ultimaEvidenciaMs: 200,
      ativacoes: 1,
    });
  });

  it("e deterministica por timestamps e nao muta o estado de entrada", () => {
    const sequencia = [presente(0), presente(100), ausente(200), ausente(1400)];
    const executar = () =>
      sequencia.reduce(
        (estado, sinal) => reduzirFrequenciaAdaptativa(estado, sinal, config),
        estadoInicialFrequenciaAdaptativa()
      );
    const primeiro = executar();
    expect(executar()).toEqual(primeiro);

    const inicial = estadoInicialFrequenciaAdaptativa();
    reduzirFrequenciaAdaptativa(inicial, presente(0), config);
    expect(inicial).toEqual(estadoInicialFrequenciaAdaptativa());
  });

  it("monta a cadencia efetiva preservando intervalos nao sobrescritos", () => {
    const base = { maosMs: 500, poseMs: 1000, deteccaoMs: 1000 };
    expect(cadenciaParaModo(config, "base", base)).toEqual(base);
    expect(cadenciaParaModo(config, "atencao", base)).toEqual({
      maosMs: 200,
      poseMs: 500,
      deteccaoMs: 1000,
    });
    expect(cadenciaParaModo(config, "base")).toBeUndefined();
  });
});
