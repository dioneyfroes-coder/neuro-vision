import { describe, expect, it } from "vitest";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { criarMotor, maoComGesto, obs, posePessoa, reiniciarContador } from "./helpers/motor-temporal";

describe("MotorTemporalImpl — objetos e cena", () => {
  it("deteccao de objeto gera evento de aparicao", () => {
    reiniciarContador();
    const motor = criarMotor();
    const deteccao = {
      nome: "pessoa",
      rotulo: "person",
      score: 0.9,
      caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 },
    };
    const r1 = motor.processar([obs({ ms: 0, deteccoes: { deteccoes: [deteccao] } })]);
    const r2 = motor.processar([obs({ ms: 100, deteccoes: { deteccoes: [deteccao] } })]);
    const todos = [...r1.eventos, ...r2.eventos];
    const aparicao = todos.find((e) => e.tipo === "aparicao");
    expect(aparicao).toBeDefined();
    expect(aparicao?.origens).toEqual(["objetos"]);
    expect(aparicao?.rotuloObjeto).toBe("person");
    expect(aparicao?.frameIds.length).toBeGreaterThanOrEqual(1);
  });

  it("movimento de objeto vira movimento_objeto, nunca movimento_corporal", () => {
    reiniciarContador();
    const motor = criarMotor();
    const caneca = (xmin: number) => ({
      nome: "caneca",
      rotulo: "cup",
      score: 0.9,
      caixa: { xmin, ymin: 0, xmax: xmin + 100, ymax: 100 },
    });
    const eventos = [];
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, deteccoes: { deteccoes: [caneca(i * 60)] } })]);
      eventos.push(...r.eventos);
    }
    const movimento = eventos.find((e) => e.tipo === "movimento_objeto");
    expect(movimento).toBeDefined();
    expect(movimento?.origens).toEqual(["objetos"]);
    expect(movimento?.rotuloObjeto).toBe("cup");
    expect(eventos.some((e) => e.tipo === "movimento_corporal")).toBe(false);
  });

  it("deslocamento de pessoa rastreada gera movimento_corporal com origem pose", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 1_000, pose: posePessoa(undefined, undefined, i * 0.05) })]);
      eventos.push(...r.eventos);
    }
    const movimento = eventos.find((e) => e.tipo === "movimento_corporal");
    expect(movimento).toBeDefined();
    expect(movimento?.origens).toEqual(["pose"]);
    expect(movimento?.entidadeId).toBe(motor.pessoasVivas[0]?.entidadeId);
    expect(eventos.some((e) => e.tipo === "movimento_objeto")).toBe(false);
  });

  it("mudanca de assinatura de cena gera evento de cena", () => {    reiniciarContador();
    const motor = criarMotor();
    const escuro = Array(9).fill(0);
    const claro = Array(9).fill(255);
    motor.processar([obs({ ms: 0, assinaturaCena: escuro })]); // registra base
    const r = motor.processar([obs({ ms: 100, assinaturaCena: claro })]);
    const cena = r.eventos.find((e) => e.tipo === "mudanca_de_cena");
    expect(cena).toBeDefined();
    expect(cena?.origens).toEqual(["cena"]);
  });

  it("modo basico (variante C) nao emite gestos nem braco, mas mantem objetos e cena", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({ modo: "basico" });
    const deteccao = {
      nome: "pessoa",
      rotulo: "person",
      score: 0.9,
      caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 },
    };
    const eventos = [];
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([
        obs({
          ms: i * 100,
          pose: posePessoa(0.2, 0.2),
          maos: maoComGesto("mao_aberta"),
          deteccoes: { deteccoes: [deteccao] },
        }),
      ]);
      eventos.push(...r.eventos);
    }
    // A leitura ampliada (pose/maos + maquinas) nao roda no modo basico.
    expect(eventos.some((e) => e.tipo === "gesto_detectado")).toBe(false);
    expect(eventos.some((e) => e.tipo === "braco_levantado")).toBe(false);
    expect(motor.pessoasVivas).toHaveLength(0);
    expect(motor.maosVivas).toHaveLength(0);
    // Objetos continuam sendo rastreados (logica pre-existente).
    expect(eventos.some((e) => e.tipo === "aparicao")).toBe(true);

    // Cena tambem continua valendo no modo basico.
    const cena = motor.processar([obs({ ms: 400, assinaturaCena: Array(9).fill(255) })]);
    const rBase = motor.processar([obs({ ms: 500, assinaturaCena: Array(9).fill(0) })]);
    expect([...cena.eventos, ...rBase.eventos].some((e) => e.tipo === "mudanca_de_cena")).toBe(true);
  });

  it("mudanca de resolucao nao troca o ID da pessoa (coordenadas normalizadas)", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, pose: posePessoa(0.7, 0.7) })]);
    const id1 = motor.pessoasVivas[0]?.entidadeId;
    expect(id1).toBeDefined();
    motor.processar([
      obs({
        ms: 100,
        pose: posePessoa(0.7, 0.7),
        deteccoes: { deteccoes: [], dimensoes: { largura: 1920, altura: 1080 } },
      }),
    ]);
    expect(motor.pessoasVivas[0]?.entidadeId).toBe(id1);
  });

  it("emite pose_compativel_sexual como indicio quando o NSFW esta ativo", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      avaliarPoseSexual: true,
      poseSexual: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
      regrasPoseSexual: { distanciaMaoGenital: 0.2 },
    });
    const eventos = [];
    // Punhos na altura do quadril: a mao fica proxima da regiao genital
    // estimada e a regra atinge o limiar de pose compativel.
    for (let i = 0; i < 2; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, pose: posePessoa(0.6, 0.6) })]);
      eventos.push(...r.eventos);
    }
    const evento = eventos.find((e) => e.tipo === "pose_compativel_sexual");
    expect(evento).toBeDefined();
    expect(evento?.estado).toBe("confirmado");
    expect(evento?.origens).toEqual(["pose"]);
    expect(evento?.descricao).toMatch(/indicio geometrico, nao prova/i);
    expect(evento?.evidencias?.join(" ")).toContain("mao_proxima_genital");
  });

  it("nao emite pose_compativel_sexual quando as regras estao desligadas", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, pose: posePessoa(0.6, 0.6) })]);
      eventos.push(...r.eventos);
    }
    expect(eventos.some((e) => e.tipo === "pose_compativel_sexual")).toBe(false);
  });

  it("encerra a pose compativel quando o sinal deixa de ser observado", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      avaliarPoseSexual: true,
      poseSexual: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
      regrasPoseSexual: { distanciaMaoGenital: 0.2 },
    });
    const eventos = [];
    for (let i = 0; i < 2; i += 1) {
      eventos.push(...motor.processar([obs({ ms: i * 100, pose: posePessoa(0.6, 0.6) })]).eventos);
    }
    // Punhos longe da genital e pernas fechadas: o sinal some.
    for (let i = 2; i < 4; i += 1) {
      eventos.push(...motor.processar([obs({ ms: i * 100, pose: posePessoa(0.1, 0.1) })]).eventos);
    }
    const encerrado = eventos.find(
      (e) => e.tipo === "pose_compativel_sexual" && e.estado === "encerrado"
    );
    expect(encerrado).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cadencia independente: frames nao amostrados nao sao ausencia de sinal
// ---------------------------------------------------------------------------
