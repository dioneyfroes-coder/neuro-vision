import { describe, expect, it } from "vitest";
import { indisponivel } from "../src/domain";
import type { ObservacaoFrame } from "../src/domain";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { criarMotor, maoComGesto, obs, posePessoa, reiniciarContador } from "./helpers/motor-temporal";

describe("MotorTemporalImpl — estado entre ciclos", () => {
  it("reutiliza a entidade entre chamadas e sinaliza periodo cego", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta"), cycleId: "c1" })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta"), cycleId: "c1" })]);
    expect(r2.eventos.some((e) => e.estado === "confirmado")).toBe(true);
    expect(r2.houveIntervaloSemObservacao).toBeFalsy();

    // Gap grande entre ciclos -> periodo cego.
    const r3 = motor.processar([obs({ ms: 5000, maos: maoComGesto("mao_aberta"), cycleId: "c2" })]);
    expect(r3.houveIntervaloSemObservacao).toBe(true);
    expect(r3.intervaloSemObservacaoMs).toBe(5000 - 100);
  });

  it("periodo cego interrompe evento ativo como incerto, sem presumir continuidade", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta"), cycleId: "c1" })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta"), cycleId: "c1" })]);
    const confirmado = r2.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
    );
    expect(confirmado).toBeDefined();

    // Gap grande -> o gesto ativo e interrompido (nao presume continuidade).
    const r3 = motor.processar([obs({ ms: 6000, maos: maoComGesto("mao_aberta"), cycleId: "c2" })]);
    const interrompido = r3.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "incerto"
    );
    expect(interrompido).toBeDefined();
    expect(interrompido?.eventoId).toBe(confirmado?.eventoId);
    expect(interrompido?.intervaloSemObservacaoMs).toBe(6000 - 100);
    // O periodo cego invalida a continuidade: ela nao e presumida na lacuna.
    expect(interrompido?.continuidadeValida).toBe(false);
    expect(interrompido?.motivoEncerramento).toBe("periodo_cego");
    // Fim registrado como a ultima evidencia positiva (ms=100), nao o inicio
    // (ms=0) nem o instante da lacuna (ms=6000).
    const fim = Date.parse(interrompido!.fimEm!);
    const inicio = Date.parse(interrompido!.inicioEm);
    expect(fim).toBe(Date.parse(new Date(1700000000000 + 100).toISOString()));
    expect(fim).toBeGreaterThan(inicio);
  });

  it("lacuna entre ciclos usa a ultima observacao global, nao a ultima evidencia", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
      gestos: { framesParaConfirmar: 2, framesParaEncerrar: 5, confiancaMinima: 0.5 },
    });
    // Mesma mao/posicao, porem sem gesto: a entidade e observada, o sinal nao.
    const maoSemGesto = (): ObservacaoFrame["maos"] => ({
      maos: [
        {
          lateralidade: "direita",
          landmarks: [
            { x: 0.5, y: 0.4 },
            { x: 0.52, y: 0.38 },
          ],
        },
      ],
    });

    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta"), cycleId: "c1" })]);
    const r2 = motor.processar([
      obs({ ms: 100, maos: maoComGesto("mao_aberta"), cycleId: "c1" }),
    ]);
    expect(
      r2.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(true);

    // A mao continua visivel (sem gesto): a observacao avanca, a evidencia nao.
    motor.processar([obs({ ms: 200, maos: maoSemGesto(), cycleId: "c1" })]);
    motor.processar([obs({ ms: 300, maos: maoSemGesto(), cycleId: "c1" })]);

    const r5 = motor.processar([
      obs({ ms: 5000, maos: maoComGesto("mao_aberta"), cycleId: "c2" }),
    ]);
    const interrompido = r5.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "incerto"
    );
    expect(interrompido).toBeDefined();
    expect(interrompido?.ultimaEvidenciaEm).toBe(
      new Date(1700000000000 + 100).toISOString()
    );
    expect(interrompido?.ultimaObservacaoEm).toBe(
      new Date(1700000000000 + 300).toISOString()
    );
    // O gap e medido desde a ultima observacao global (300), nao desde a
    // ultima evidencia positiva (100).
    expect(interrompido?.intervaloSemObservacaoMs).toBe(5000 - 300);
  });

  it("resetar limpa o estado entre sessoes", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    motor.resetar();
    expect(motor.maosVivas).toHaveLength(0);
    expect(motor.pessoasVivas).toHaveLength(0);
    // Apos reset, um novo gesto precisa recomecar a confirmacao.
    const r = motor.processar([obs({ ms: 200, maos: maoComGesto("mao_aberta") })]);
    expect(r.eventos.filter((e) => e.estado === "confirmado")).toHaveLength(0);
  });

  it("inferência falha nao apaga os demais subsistemas", () => {
    reiniciarContador();
    const motor = criarMotor();
    // Pose falha, maos ok: gesto ainda e detectado.
    const r = motor.processar([
      obs({ ms: 0, pose: indisponivel("pose", "timeout"), maos: maoComGesto("mao_aberta") }),
    ]);
    // Sem pessoas rastreadas, mas maos funcionando.
    expect(motor.pessoasVivas).toHaveLength(0);
    expect(motor.maosVivas).toHaveLength(1);
    expect(r.tracksAtivos).toBeGreaterThanOrEqual(1);
  });

  it("tracksAtivos conta tracks, nao entidades fisicas distintas", () => {
    reiniciarContador();
    const motor = criarMotor();
    const duasMaos: ObservacaoFrame["maos"] = {
      maos: [
        {
          lateralidade: "esquerda",
          landmarks: [
            { x: 0.4, y: 0.5 },
            { x: 0.42, y: 0.48 },
          ],
        },
        {
          lateralidade: "direita",
          landmarks: [
            { x: 0.6, y: 0.5 },
            { x: 0.62, y: 0.48 },
          ],
        },
      ],
    };

    const r = motor.processar([obs({ ms: 0, pose: posePessoa(), maos: duasMaos })]);

    expect(r.pessoasAtivas).toBe(1);
    expect(r.maosAtivas).toBe(2);
    expect(r.objetosAtivos).toBe(0);
    // Uma pessoa fisica, tres tracks: pose + mao esquerda + mao direita.
    expect(r.tracksAtivos).toBe(3);
  });

  it("falha de maos nao encerra gesto ativo", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const confirmado = r2.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
    );
    expect(confirmado).toBeDefined();

    // Maos indisponiveis por varios frames: nao encerra o gesto.
    const eventos = [];
    for (let i = 0; i < 4; i += 1) {
      const r = motor.processar([obs({ ms: 200 + i * 100, maos: indisponivel("maos", "erro") })]);
      eventos.push(...r.eventos);
    }
    expect(
      eventos.filter((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado")
    ).toHaveLength(0);

    // Recuperacao: gesto continua o mesmo evento.
    const rRec = motor.processar([obs({ ms: 700, maos: maoComGesto("mao_aberta") })]);
    expect(
      rRec.eventos.filter((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado")
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Encapsulamento de rastreamento (objetos) e cena
// ---------------------------------------------------------------------------
