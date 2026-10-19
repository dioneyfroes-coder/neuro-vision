import { describe, expect, it } from "vitest";
import { indisponivel } from "../src/domain";
import type { ObservacaoFrame, PessoaPose, PontoCorporal } from "../src/domain";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { RastreadorEntidades } from "../public/temporal/rastreador-entidades";
import { MaquinaSinais } from "../public/temporal/maquina-sinais";
import { suavizarExponencial, medirMovimento, distanciaPontos } from "../public/temporal/suavizador";

// ---------------------------------------------------------------------------
// Helpers deterministicos
// ---------------------------------------------------------------------------

let contador = 0;

function reiniciarContador() {
  contador = 0;
}

interface OpcoesObs {
  ms: number;
  deteccoes?: ObservacaoFrame["deteccoes"];
  pose?: ObservacaoFrame["pose"];
  maos?: ObservacaoFrame["maos"];
  assinaturaCena?: number[];
  cycleId?: string;
}

function obs(o: OpcoesObs): ObservacaoFrame {
  contador += 1;
  return {
    sessionId: "s1",
    cycleId: o.cycleId ?? "s1-c1",
    frameId: `f${contador}`,
    capturadoEm: new Date(1700000000000 + o.ms).toISOString(),
    capturadoEmMs: o.ms,
    imagem: "data:,",
    assinaturaCena: o.assinaturaCena,
    deteccoes: o.deteccoes ?? indisponivel("deteccao", "desativado"),
    pose: o.pose ?? indisponivel("pose", "desativado"),
    maos: o.maos ?? indisponivel("maos", "desativado"),
    metricas: {},
  };
}

/** Pose COCO (17 pontos) com os punhos em alturas configuraveis. */
function posePessoa(punhoEsqY?: number, punhoDirY?: number): ObservacaoFrame["pose"] {
  const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
    x: 0.5,
    y: 0.6,
    confianca: 0.9,
  }));
  if (punhoEsqY !== undefined) pontos[9] = { x: 0.4, y: punhoEsqY, confianca: 0.9 };
  if (punhoDirY !== undefined) pontos[10] = { x: 0.6, y: punhoDirY, confianca: 0.9 };
  return { pessoas: [{ pontos, confianca: 0.9 } as PessoaPose] };
}

function maoComGesto(nome: string, confianca = 0.9): ObservacaoFrame["maos"] {
  return {
    maos: [
      {
        lateralidade: "direita",
        landmarks: [
          { x: 0.5, y: 0.4 },
          { x: 0.52, y: 0.38 },
        ],
        gesto: { nome, confianca },
      },
    ],
  };
}

function criarMotor() {
  return new MotorTemporalImpl({
    rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
    gestos: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
    braco: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
    limiarAlturaBraco: 0.4,
  });
}

// ---------------------------------------------------------------------------
// Suavizador e metricas
// ---------------------------------------------------------------------------

describe("suavizador", () => {
  it("suaviza exponencialmente e mede movimento", () => {
    expect(suavizarExponencial(0.5, 0, 1)).toBeCloseTo(0.5);
    expect(suavizarExponencial(0, 0, 1)).toBeCloseTo(1);
    expect(suavizarExponencial(1, 0, 1)).toBeCloseTo(0);
    expect(distanciaPontos({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
    const m = medirMovimento({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.2 });
    expect(m.deslocamentoY).toBeCloseTo(-0.3); // negativo = subindo
    expect(m.deslocamento).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// Rastreador de entidades: IDs estaveis e suavizacao
// ---------------------------------------------------------------------------

describe("RastreadorEntidades", () => {
  it("mantem ID estavel e suaviza o centro entre frames", () => {
    const r = new RastreadorEntidades({ distanciaMaxima: 0.3, alphaSuavizacao: 0.5 }, "t");
    const a1 = r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    expect(a1).toHaveLength(1);
    const id = a1[0].entidadeId;

    const a2 = r.atualizar([{ x: 0.6, y: 0.5, confianca: 0.9 }], 100);
    expect(a2[0].entidadeId).toBe(id); // mesmo ID
    // centro suavizado: 0.5*0.5 + 0.5*0.6 = 0.55
    expect(a2[0].x).toBeCloseTo(0.55);
    expect(a2[0].deslocamento).toBeGreaterThan(0);
  });

  it("descarta entidade apos ficar ausente ha tempo demais", () => {
    const r = new RastreadorEntidades({ distanciaMaxima: 0.3, maxFramesAusente: 2 }, "t");
    r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    r.atualizar([], 100);
    r.atualizar([], 200);
    expect(r.vivas).toHaveLength(1); // framesAusente = 2, ainda tolerado
    r.atualizar([], 300);
    expect(r.vivas).toHaveLength(0); // removido
  });
});

// ---------------------------------------------------------------------------
// Maquina de sinais: confirmacao e encerramento temporais
// ---------------------------------------------------------------------------

describe("MaquinaSinais", () => {
  it("confirma apos N frames e encerra apos M frames sem sinal", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    expect(m.processar([leitura("gesto_a", 1)])).toHaveLength(0); // candidato
    const confirmados = m.processar([leitura("gesto_a", 2)]);
    expect(confirmados).toHaveLength(1);
    expect(confirmados[0].estado).toBe("confirmado");
    const eventoId = confirmados[0].eventoId;

    // Sinal ausente por 1 frame: ainda nao encerra.
    expect(m.processar([leitura(null, 3)])).toHaveLength(0);
    const encerrados = m.processar([leitura(null, 4)]);
    expect(encerrados).toHaveLength(1);
    expect(encerrados[0].estado).toBe("encerrado");
    expect(encerrados[0].eventoId).toBe(eventoId); // identidade estavel
    expect(encerrados[0].fimEm).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Sequencias sinteticas do motor
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
});

describe("MotorTemporalImpl — gestos", () => {
  it("mão aberta mantida confirma gesto_detectado", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, maos: maoComGesto("mao_aberta") })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado).toBeDefined();
    expect(confirmado?.descricao).toContain("mao_aberta");
    expect(confirmado?.origens).toEqual(["maos"]);
  });

  it("polegar para cima mantido confirma gesto_detectado", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, maos: maoComGesto("polegar_para_cima") })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado?.descricao).toContain("polegar_para_cima");
  });

  it("gesto instável (1 frame) não confirma", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r1 = motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    expect(r1.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);
    // Some no frame seguinte.
    const r2 = motor.processar([obs({ ms: 100, maos: { maos: [] } })]);
    const r3 = motor.processar([obs({ ms: 200, maos: { maos: [] } })]);
    const todos = [...r1.eventos, ...r2.eventos, ...r3.eventos];
    expect(todos.filter((e) => e.estado === "confirmado")).toHaveLength(0);
  });

  it("mão ocultada encerra o gesto ativo com duração e evidencia", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const confirmado = r2.eventos.find((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado");
    expect(confirmado).toBeDefined();

    // Mao oculta por 2 frames (>= framesParaEncerrar).
    motor.processar([obs({ ms: 200, maos: { maos: [] } })]);
    const r4 = motor.processar([obs({ ms: 300, maos: { maos: [] } })]);
    const encerrado = r4.eventos.find((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado");
    expect(encerrado).toBeDefined();
    expect(encerrado?.eventoId).toBe(confirmado?.eventoId);
    expect(encerrado?.fimEm).toBeDefined();
    // duracao = fim - inicio (300 - 0 = 300ms apos normalizar epoch).
    const dur = Date.parse(encerrado!.fimEm!) - Date.parse(encerrado!.inicioEm);
    expect(dur).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Reuso de estado, periodo cego, reset
// ---------------------------------------------------------------------------

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
    expect(r.entidadesAtivas).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Encapsulamento de rastreamento (objetos) e cena
// ---------------------------------------------------------------------------

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
    expect(aparicao?.frameIds.length).toBeGreaterThanOrEqual(1);
  });

  it("mudanca de assinatura de cena gera evento de cena", () => {
    reiniciarContador();
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
});
