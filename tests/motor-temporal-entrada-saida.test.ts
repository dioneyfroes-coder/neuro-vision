import { describe, expect, it } from "vitest";
import { naoAmostrado } from "../src/domain";
import { criarMotor, obs, posePessoa, reiniciarContador } from "./helpers/motor-temporal";

describe("MotorTemporalImpl — entrada/saida de pessoas (Fase 4)", () => {
  const isoMs = (ms: number) => new Date(1700000000000 + ms).toISOString();

  it("emite exatamente um par entrada/saida com o mesmo entidadeId", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];

    eventos.push(...motor.processar([obs({ ms: 0, pose: posePessoa() })]).eventos);
    expect(eventos.some((e) => e.tipo === "aparicao")).toBe(false);

    eventos.push(...motor.processar([obs({ ms: 100, pose: posePessoa() })]).eventos);
    const entradas = eventos.filter((e) => e.tipo === "aparicao");
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toMatchObject({
      origens: ["pose"],
      estado: "confirmado",
      entidadeId: motor.pessoasVivas[0]?.entidadeId,
      inicioEm: isoMs(100),
      ultimaEvidenciaEm: isoMs(100),
      frameIds: ["f2"],
    });

    // Duas ausencias ainda estao dentro da histerese.
    for (let i = 2; i < 4; i += 1) {
      eventos.push(...motor.processar([obs({ ms: i * 100, pose: { pessoas: [] } })]).eventos);
    }
    expect(eventos.some((e) => e.tipo === "desaparecimento")).toBe(false);

    eventos.push(...motor.processar([obs({ ms: 400, pose: { pessoas: [] } })]).eventos);
    const saidas = eventos.filter((e) => e.tipo === "desaparecimento");
    expect(saidas).toHaveLength(1);
    expect(saidas[0]).toMatchObject({
      origens: ["pose"],
      estado: "confirmado",
      entidadeId: entradas[0].entidadeId,
      inicioEm: isoMs(400),
      ultimaEvidenciaEm: isoMs(100),
      ultimaObservacaoEm: isoMs(400),
      frameIds: ["f5"],
      motivoEncerramento: "oclusao",
    });

    eventos.push(...motor.processar([obs({ ms: 500, pose: { pessoas: [] } })]).eventos);
    expect(eventos.filter((e) => e.tipo === "desaparecimento")).toHaveLength(1);
  });

  it("oclusao curta preserva o entidadeId e nao emite nova entrada", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];

    for (let i = 0; i < 2; i += 1) {
      eventos.push(...motor.processar([obs({ ms: i * 100, pose: posePessoa() })]).eventos);
    }
    const id = motor.pessoasVivas[0]?.entidadeId;
    expect(id).toBeDefined();

    eventos.push(...motor.processar([obs({ ms: 200, pose: { pessoas: [] } })]).eventos);
    expect(eventos.some((e) => e.tipo === "desaparecimento")).toBe(false);

    eventos.push(...motor.processar([obs({ ms: 300, pose: posePessoa() })]).eventos);
    expect(motor.pessoasVivas[0]?.entidadeId).toBe(id);
    expect(eventos.filter((e) => e.tipo === "aparicao")).toHaveLength(1);
    expect(eventos.filter((e) => e.tipo === "desaparecimento")).toHaveLength(0);
  });

  it("nao conta pose nao amostrada como ausencia de pessoa", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];

    for (let i = 0; i < 2; i += 1) {
      eventos.push(...motor.processar([obs({ ms: i * 100, pose: posePessoa() })]).eventos);
    }
    for (let i = 2; i < 8; i += 1) {
      eventos.push(
        ...motor.processar([obs({ ms: i * 100, pose: naoAmostrado("pose") })]).eventos
      );
    }
    expect(eventos.filter((e) => e.tipo === "aparicao")).toHaveLength(1);
    expect(eventos.filter((e) => e.tipo === "desaparecimento")).toHaveLength(0);
  });

  it("periodo cego encerra presenca como incerto sem afirmar saida", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];

    for (let i = 0; i < 2; i += 1) {
      eventos.push(...motor.processar([obs({ ms: i * 100, pose: posePessoa() })]).eventos);
    }
    eventos.push(...motor.processar([obs({ ms: 1_500, pose: posePessoa() })]).eventos);

    const incerto = eventos.find(
      (e) => e.tipo === "desaparecimento" && e.estado === "incerto"
    );
    expect(incerto).toBeDefined();
    expect(incerto).toMatchObject({
      origens: ["pose"],
      entidadeId: eventos.find((e) => e.tipo === "aparicao")?.entidadeId,
      inicioEm: isoMs(100),
      ultimaEvidenciaEm: isoMs(100),
      frameIds: ["f2"],
      intervaloSemObservacaoMs: 1_400,
      motivoEncerramento: "periodo_cego",
      continuidadeValida: false,
    });
  });

  it("pose disponivel substitui a aparicao de persona do detector de objetos", () => {
    reiniciarContador();
    const motor = criarMotor();
    const deteccao = {
      nome: "pessoa",
      rotulo: "person",
      score: 0.9,
      caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 },
    };
    const eventos = [];
    for (let i = 0; i < 2; i += 1) {
      eventos.push(
        ...motor.processar([
          obs({
            ms: i * 100,
            pose: posePessoa(),
            deteccoes: { deteccoes: [deteccao] },
          }),
        ]).eventos
      );
    }
    const aparicoes = eventos.filter((e) => e.tipo === "aparicao");
    expect(aparicoes).toHaveLength(1);
    expect(aparicoes[0].origens).toEqual(["pose"]);
  });
});
