import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MODOS, MODO_PADRAO, obterModo } from "../public/modos";
import { MotorDeteccao, MotorVisao } from "../public/motores";
import * as api from "../public/api";
import type { DetectorObjetos } from "../public/perception/contracts";

vi.mock("../public/api", () => ({
  descreverFrame: vi.fn(),
  prepararVisao: vi.fn(),
}));

const detector = {
  modelo: "onnx-community/yolov10n",
  carregar: vi.fn(),
  detectar: vi.fn(),
} as unknown as DetectorObjetos;

const deps = {
  detector,
  modelo: "onnx-community/yolov10n",
  obterThreshold: () => 0.4,
};

describe("MODOS", () => {
  it("deteccao e eventos usam o motor de deteccao", () => {
    expect(obterModo("deteccao").criarMotor(deps)).toBeInstanceOf(MotorDeteccao);
    expect(obterModo("eventos").criarMotor(deps)).toBeInstanceOf(MotorDeteccao);
  });

  it("visao e roteiro usam o motor de visao com o modo correto", () => {
    const descricao = obterModo("visao").criarMotor(deps) as MotorVisao;
    const roteiro = obterModo("roteiro").criarMotor(deps) as MotorVisao;
    expect(descricao).toBeInstanceOf(MotorVisao);
    expect(descricao.id).toBe("visao");
    expect(roteiro.id).toBe("roteiro");
  });

  it("repassa o modelo de visao escolhido na interface para o motor", async () => {
    vi.mocked(api.descreverFrame).mockResolvedValue({ evento: null, parcial: "" });
    const motor = obterModo("visao").criarMotor({
      ...deps,
      modeloVisao: "gemma-4-e2b-uncensored-hauhaucs-aggressive",
    }) as MotorVisao;

    await motor.analisar({ imagem: "b64" }, new AbortController().signal);

    expect(api.descreverFrame).toHaveBeenCalledWith(
      { imagem: "b64", modelo: "gemma-4-e2b-uncensored-hauhaucs-aggressive" },
      expect.any(AbortSignal),
      undefined
    );
  });

  it("expoe as flags usadas pelo diagnostico e pela interface", () => {
    expect(obterModo("eventos")).toMatchObject({
      usaDeteccao: true,
      usaVisao: true,
      permiteAnaliseManual: true,
    });
    expect(obterModo("deteccao")).toMatchObject({
      usaDeteccao: true,
      usaVisao: false,
      permiteAnaliseManual: false,
    });
    expect(obterModo("visao")).toMatchObject({
      usaDeteccao: false,
      usaVisao: true,
      permiteAnaliseManual: false,
    });
  });

  it("percepcao e o modo multiframe e nao usa motor de frame unico", () => {
    expect(obterModo("percepcao")).toMatchObject({
      id: "percepcao",
      usaDeteccao: true,
      usaVisao: true,
      permiteAnaliseManual: false,
      multiframe: true,
    });
    expect(obterModo("percepcao").criarMotor).toBeUndefined();
  });

  it("os modos multiframe expoem as variantes B/C/D do benchmark (Etapa 9)", () => {
    expect(obterModo("percepcao").variante).toMatchObject({
      id: "completa",
      percepcaoLocal: true,
      dadosLocais: true,
      temporal: "ampliado",
    });
    expect(obterModo("percepcao-fundida")).toMatchObject({
      id: "percepcao-fundida",
      usaDeteccao: true,
      multiframe: true,
    });
    expect(obterModo("percepcao-fundida").variante).toMatchObject({
      id: "fundida",
      percepcaoLocal: true,
      dadosLocais: true,
      temporal: "basico",
    });
    expect(obterModo("percepcao-sequencia")).toMatchObject({
      id: "percepcao-sequencia",
      usaDeteccao: false,
      usaVisao: true,
      multiframe: true,
    });
    expect(obterModo("percepcao-sequencia").variante).toMatchObject({
      id: "sequencia",
      percepcaoLocal: false,
      dadosLocais: false,
      temporal: "ausente",
    });
    // Nenhum modo multiframe usa o motor de frame unico.
    expect(obterModo("percepcao-fundida").criarMotor).toBeUndefined();
    expect(obterModo("percepcao-sequencia").criarMotor).toBeUndefined();
  });

  it("preserva as mensagens de falha esperadas pelos testes E2E", () => {
    expect(obterModo("deteccao").falhaPrefixo).toBe("Falha ao carregar modelo");
    expect(obterModo("eventos").falhaPrefixo).toBe("Falha ao carregar modelo");
    expect(obterModo("visao").falhaPrefixo).toBe("Falha ao preparar o modelo de visao");
    expect(obterModo("roteiro").falhaPrefixo).toBe("Falha ao preparar o modelo de visao");
  });

  it("modo desconhecido cai no padrao (pipeline multi-frame)", () => {
    expect(obterModo("inexistente")).toBe(MODOS.percepcao);
    expect(MODO_PADRAO).toBe("percepcao");
  });

  it("o seletor da interface expoe apenas percepcao; B/C sao de benchmark", () => {
    // Requisito da UI: as categorias de benchmark (B/C/D) nao sao escolhas de
    // usuario. So `percepcao` (a arquitetura-alvo) aparece no menu.
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const seletor = html.match(/<select id="motor">([\s\S]*?)<\/select>/)?.[1] ?? "";
    const valores = [...seletor.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(valores).toEqual(["percepcao", "roteiro", "deteccao", "visao", "eventos"]);
    // Continuam no registro MODOS para o harness de benchmark (Etapa 9) e o E2E.
    expect(obterModo("percepcao-fundida").variante?.id).toBe("fundida");
    expect(obterModo("percepcao-sequencia").variante?.id).toBe("sequencia");
  });
});
