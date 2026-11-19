import { describe, expect, it } from "vitest";
import { naoAmostrado } from "../src/domain";
import { criarMotor, maoComGesto, obs, posePessoa, reiniciarContador } from "./helpers/motor-temporal";

describe("MotorTemporalImpl — frames nao amostrados pela cadencia", () => {
  it("nao reseta candidatos de gesto quando as maos nao foram amostradas", () => {
    reiniciarContador();
    const motor = criarMotor(); // gestos: 2 frames para confirmar
    const eventos = [];

    // Frame 1: gesto valido (candidato 1). Frame 2: maos puladas pela cadencia.
    // Frame 3: gesto valido (candidato 2) -> confirma.
    eventos.push(...motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]).eventos);
    motor.processar([obs({ ms: 200, maos: naoAmostrado("maos") })]);
    eventos.push(...motor.processar([obs({ ms: 400, maos: maoComGesto("mao_aberta") })]).eventos);

    const confirmado = eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
    );
    expect(confirmado).toBeDefined();
    expect(confirmado?.frameIds).toContain("f1");
  });

  it("nao encerra gesto confirmado por frames nao amostrados (nao e ausencia)", () => {
    reiniciarContador();
    const motor = criarMotor(); // gestos: 2 para encerrar
    const eventos = [];

    for (let i = 0; i < 2; i += 1) {
      eventos.push(
        ...motor.processar([obs({ ms: i * 100, maos: maoComGesto("mao_aberta") })]).eventos
      );
    }
    expect(
      eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(true);

    // Muito mais frames pulados do que `framesParaEncerrar`: se fossem lidos
    // como ausencia, o gesto encerraria.
    for (let i = 2; i < 6; i += 1) {
      eventos.push(
        ...motor.processar([obs({ ms: i * 100, maos: naoAmostrado("maos") })]).eventos
      );
    }
    expect(
      eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado")
    ).toBe(false);
  });

  it("nao reseta candidatos de braco quando a pose nao foi amostrada", () => {
    reiniciarContador();
    const motor = criarMotor(); // braco: 2 frames para confirmar
    const eventos = [];

    eventos.push(...motor.processar([obs({ ms: 0, pose: posePessoa(0.3, 0.9) })]).eventos);
    motor.processar([obs({ ms: 200, pose: naoAmostrado("pose") })]);
    eventos.push(...motor.processar([obs({ ms: 400, pose: posePessoa(0.3, 0.9) })]).eventos);

    expect(
      eventos.some((e) => e.tipo === "braco_levantado" && e.estado === "confirmado")
    ).toBe(true);
  });

  it("nao conta frame de maos nao amostrado como observacao da entidade", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const pulado = motor.processar([obs({ ms: 200, maos: naoAmostrado("maos") })]);

    // O frame pulado nem entra nos diagnosticos: nao ha "oco/ausente" novo.
    expect(pulado.diagnosticos ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Entrada e saida de pessoas (Fase 4, item 1)
// ---------------------------------------------------------------------------
