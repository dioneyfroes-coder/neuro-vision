import { describe, expect, it, vi } from "vitest";
import {
  AdaptadorMaos,
  mapearGesto,
  mapearLateralidade,
  normalizarMaos,
} from "../public/perception/adapters/hand-gesture.adapter";
import type { MotorMaos, SaidaMaosCru } from "../public/perception/adapters/hand-gesture.adapter";
import { estaIndisponivel } from "../src/domain";

function saida(parcial: Partial<SaidaMaosCru> = {}): SaidaMaosCru {
  return {
    maos: [
      {
        landmarks: [
          { x: 0.1, y: 0.2, z: 0.0 },
          { x: 1.2, y: -0.3, z: -0.1 },
        ],
        lateralidade: "Right",
        gestos: [
          { nome: "Thumb_Up", confianca: 0.82 },
          { nome: "Victory", confianca: 0.11 },
        ],
      },
    ],
    ...parcial,
  };
}

describe("mapearLateralidade", () => {
  it("traduz os rotulos do MediaPipe e trata desconhecidos", () => {
    expect(mapearLateralidade("Left")).toBe("esquerda");
    expect(mapearLateralidade("right")).toBe("direita");
    expect(mapearLateralidade(undefined)).toBe("desconhecida");
    expect(mapearLateralidade("ambos")).toBe("desconhecida");
  });
});

describe("mapearGesto", () => {
  it("usa nomes conhecidos em portugues e normaliza os demais", () => {
    expect(mapearGesto("Thumb_Up")).toBe("polegar_para_cima");
    expect(mapearGesto("Open_Palm")).toBe("mao_aberta");
    expect(mapearGesto("Some-New Gesture")).toBe("some_new_gesture");
  });
});

describe("normalizarMaos", () => {
  it("normaliza landmarks, lateralidade e gesto mais provavel", () => {
    const resultado = normalizarMaos(saida());
    expect(resultado.maos).toHaveLength(1);
    const mao = resultado.maos[0];
    expect(mao.lateralidade).toBe("direita");
    expect(mao.landmarks).toEqual([
      { x: 0.1, y: 0.2, z: 0 },
      { x: 1, y: 0, z: -0.1 },
    ]);
    // Gesto top-1 (nao a lista inteira) e confianca limitada a [0, 1].
    expect(mao.gesto).toEqual({ nome: "polegar_para_cima", confianca: 0.82 });
  });

  it("omite gesto quando a categoria e 'None' ou ausente", () => {
    const semGesto = normalizarMaos(saida({ maos: [{ landmarks: [], lateralidade: "Left" }] }));
    expect(semGesto.maos[0].gesto).toBeUndefined();

    const none = normalizarMaos(
      saida({ maos: [{ landmarks: [], gestos: [{ nome: "None", confianca: 0.9 }] }] })
    );
    expect(none.maos[0].gesto).toBeUndefined();
    expect(none.maos[0].lateralidade).toBe("desconhecida");
  });
});

describe("AdaptadorMaos", () => {
  function motorFalso(saidaCrua: SaidaMaosCru): MotorMaos {
    return { executar: () => Promise.resolve(saidaCrua) };
  }

  it("carrega o motor, mede a carga e devolve as maos normalizadas", async () => {
    const criarMotor = vi.fn(() => Promise.resolve(motorFalso(saida())));
    const adaptador = new AdaptadorMaos(criarMotor);

    await adaptador.carregar("gesture_recognizer.task", () => {});
    expect(criarMotor).toHaveBeenCalledWith("gesture_recognizer.task", expect.any(Function));
    expect(adaptador.modelo).toBe("gesture_recognizer.task");
    expect(adaptador.metricas.tempoCargaMs).toBeTypeOf("number");

    const resultado = await adaptador.reconhecer({ imagem: "x" });
    expect(estaIndisponivel(resultado)).toBe(false);
    if (estaIndisponivel(resultado)) throw new Error("nao esperado");
    expect(resultado.maos[0].gesto?.nome).toBe("polegar_para_cima");
    expect(adaptador.metricas.tempoInferenciaMs).toBeTypeOf("number");
  });

  it("devolve indisponivel quando o motor ainda nao foi carregado", async () => {
    const adaptador = new AdaptadorMaos(() => Promise.resolve(motorFalso(saida())));
    const resultado = await adaptador.reconhecer({ imagem: "x" });
    expect(resultado).toMatchObject({ indisponivel: true, subsistema: "maos" });
  });

  it("converte falha de inferencia em indisponivel", async () => {
    const adaptador = new AdaptadorMaos(() =>
      Promise.resolve({ executar: () => Promise.reject(new Error("mediapipe falhou")) })
    );
    await adaptador.carregar("m", () => {});
    const resultado = await adaptador.reconhecer({ imagem: "x" });
    expect(resultado).toEqual({ indisponivel: true, subsistema: "maos", motivo: "mediapipe falhou" });
    expect(adaptador.metricas.tempoInferenciaMs).toBeTypeOf("number");
  });
});
