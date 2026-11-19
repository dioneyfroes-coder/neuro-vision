import { describe, expect, it } from "vitest";
import { indisponivel } from "../src/domain";
import type { PessoaPose } from "../src/domain";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { criarMotor, obs, posePessoa, reiniciarContador } from "./helpers/motor-temporal";

// ---------------------------------------------------------------------------

describe("MotorTemporalImpl — braço", () => {
  it("braço parado abaixo do limiar não gera evento de braco", () => {
    reiniciarContador();
    const motor = criarMotor();
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, pose: posePessoa(0.7, 0.7) })]);
      expect(r.eventos.filter((e) => e.tipo === "braco_levantado")).toHaveLength(0);
    }
  });

  it("braço subindo confirma braco_levantado e encerra ao abaixar", () => {
    reiniciarContador();
    const motor = criarMotor();
    const alturas = [0.7, 0.55, 0.3, 0.25, 0.6, 0.75];
    const eventos = [];
    for (let i = 0; i < alturas.length; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, pose: posePessoa(alturas[i], 0.9) })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "braco_levantado"));
    }

    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado).toBeDefined();
    expect(confirmado?.origens).toEqual(["pose"]);
    expect(confirmado?.confianca).toBeGreaterThan(0.5);
    expect(confirmado?.frameIds.length).toBeGreaterThanOrEqual(2);

    const encerrado = eventos.find((e) => e.estado === "encerrado");
    expect(encerrado).toBeDefined();
    expect(encerrado?.fimEm).toBeDefined();
    expect(encerrado?.eventoId).toBe(confirmado?.eventoId);
  });

  it("punho alto sem relacao articular (abaixo do ombro) nao confirma", () => {
    reiniciarContador();
    // Configura ombros e cotovelos acima do punho erguido (punho abaixo deles):
    // apenas um ponto alto nao basta; a relacao ombro/cotovelo/punho e exigida.
    const motor = criarMotor();
    const eventos = [];
    const alturas = [0.2, 0.2, 0.2, 0.2];
    for (let i = 0; i < alturas.length; i += 1) {
      const basePose = posePessoa(alturas[i], 0.9);
      // ombros (5/6), cotovelos (7/8) e restante acima (y menor) que o punho.
      if (!("indisponivel" in (basePose as object))) {
        const pontos = (basePose as { pessoas: PessoaPose[] }).pessoas[0].pontos;
        for (const idx of [5, 6, 7, 8]) pontos[idx] = { x: 0.5, y: 0.15, confianca: 0.9 };
      }
      const r = motor.processar([obs({ ms: i * 100, pose: basePose })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "braco_levantado"));
    }
    // Punho (0.2) esta abaixo do ombro/cotovelo (0.15): nao ha braco erguido.
    expect(eventos.filter((e) => e.estado === "confirmado")).toHaveLength(0);
  });

  it("posicao do punho na faixa de histerese mantem o braco ativo", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
      braco: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
      limiarAlturaBraco: 0.4,
      histereseBraco: 0.15,
    });
    const eventos = [];
    // 0.3 confirma (<= 0.4). Depois 0.5 fica na faixa de histerese (<= 0.55),
    // mantendo o sinal mesmo acima do limiar de entrada.
    const alturas = [0.3, 0.3, 0.5, 0.5];
    for (let i = 0; i < alturas.length; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, pose: posePessoa(alturas[i], 0.9) })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "braco_levantado"));
    }
    expect(eventos.filter((e) => e.estado === "confirmado")).toHaveLength(1);
    // O braco nao encerrou na faixa de histerese.
    expect(eventos.filter((e) => e.estado === "encerrado")).toHaveLength(0);
  });

  it("distingue transicao (braco subindo) de postura mantida (braco_levantado)", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    // Sobe em 4 passos e depois mantem a postura por 3 frames.
    const alturas = [0.7, 0.55, 0.3, 0.25, 0.25, 0.25, 0.25];
    for (let i = 0; i < alturas.length; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, pose: posePessoa(alturas[i], 0.9) })]);
      eventos.push(...r.eventos);
    }

    const transicao = eventos.find(
      (e) => e.tipo === "transicao_acao" && e.estado === "confirmado"
    );
    expect(transicao).toBeDefined();
    expect(transicao?.descricao).toContain("subindo");
    expect(transicao?.origens).toEqual(["pose"]);
    expect(transicao?.evidencias?.some((e) => e.startsWith("velocidadeY:"))).toBe(true);
    expect(transicao?.continuidadeValida).toBe(true);

    // A postura mantida e um evento separado e permanece ativa quando a
    // transicao ja terminou.
    const postura = eventos.find(
      (e) => e.tipo === "braco_levantado" && e.estado === "confirmado"
    );
    expect(postura).toBeDefined();
    const transicaoEncerrada = eventos.find(
      (e) => e.tipo === "transicao_acao" && e.estado === "encerrado"
    );
    expect(transicaoEncerrada?.eventoId).toBe(transicao?.eventoId);
    expect(
      eventos.some((e) => e.tipo === "braco_levantado" && e.estado === "encerrado")
    ).toBe(false);
  });

  it("movimento vertical invalido nao produz transicao", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    // Mesmo instante em todos os frames: sem intervalo valido, sem velocidade.
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([obs({ ms: 0, pose: posePessoa(0.7 - i * 0.1, 0.9) })]);
      eventos.push(...r.eventos);
    }
    expect(
      eventos.some((e) => e.tipo === "transicao_acao" && e.estado === "confirmado")
    ).toBe(false);
  });

  it("falha de pose nao encerra o braco ativo; recuperacao continua o evento", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    motor.processar([obs({ ms: 0, pose: posePessoa(0.3, 0.9) })]);
    const r2 = motor.processar([obs({ ms: 100, pose: posePessoa(0.3, 0.9) })]);
    eventos.push(...r2.eventos.filter((e) => e.tipo === "braco_levantado"));
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado).toBeDefined();

    // Pose indisponivel por varios frames: o braco ativo NAO encerra.
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([obs({ ms: 200 + i * 100, pose: indisponivel("pose", "timeout") })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "braco_levantado"));
    }
    expect(eventos.filter((e) => e.estado === "encerrado")).toHaveLength(0);

    // Recuperacao: ainda erguido -> o evento continua (nada novo e emitido).
    const r3 = motor.processar([obs({ ms: 700, pose: posePessoa(0.3, 0.9) })]);
    eventos.push(...r3.eventos.filter((e) => e.tipo === "braco_levantado"));
    expect(eventos.filter((e) => e.estado === "encerrado")).toHaveLength(0);
  });
});
