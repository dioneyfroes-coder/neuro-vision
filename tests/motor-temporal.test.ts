import { describe, expect, it } from "vitest";
import { estaIndisponivel, indisponivel } from "../src/domain";
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
function posePessoa(
  punhoEsqY?: number,
  punhoDirY?: number,
  deslocamentoX = 0
): ObservacaoFrame["pose"] {
  const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
    x: 0.5 + deslocamentoX,
    y: 0.6,
    confianca: 0.9,
  }));
  if (punhoEsqY !== undefined) {
    pontos[9] = { x: 0.4 + deslocamentoX, y: punhoEsqY, confianca: 0.9 };
  }
  if (punhoDirY !== undefined) {
    pontos[10] = { x: 0.6 + deslocamentoX, y: punhoDirY, confianca: 0.9 };
  }
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

/** 21 landmarks com todos os dedos estendidos (mao aberta geometrica). */
function landmarksMaoAberta(): NonNullable<ObservacaoFrame["maos"]>["maos"][number]["landmarks"] {
  const landmarks: PontoCorporal[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[0] = { x: 0.5, y: 0.9 };
  landmarks[1] = { x: 0.4, y: 0.75 };
  landmarks[2] = { x: 0.35, y: 0.65 };
  landmarks[3] = { x: 0.3, y: 0.55 };
  landmarks[4] = { x: 0.25, y: 0.45 };
  const dedos = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, x: 0.38 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, x: 0.46 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, x: 0.54 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, x: 0.62 },
  ];
  for (const { mcp, pip, dip, tip, x } of dedos) {
    landmarks[mcp] = { x, y: 0.6 };
    landmarks[pip] = { x, y: 0.48 };
    landmarks[dip] = { x, y: 0.36 };
    landmarks[tip] = { x, y: 0.24 };
  }
  return landmarks;
}

function maoGeometrica(
  lateralidade: "esquerda" | "direita" = "direita",
  x = 0.5
): NonNullable<ObservacaoFrame["maos"]>["maos"][number] {
  return {
    lateralidade,
    landmarks: landmarksMaoAberta().map((ponto) => ({ ...ponto, x: ponto.x + (x - 0.5) })),
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

  it("expira por tempo mesmo com poucos frames ausentes", () => {
    // A contagem por frames toleraria muitos frames; a lacuna temporal longa
    // nao deve manter a entidade viva.
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.3, maxFramesAusente: 10, maxTempoAusenteMs: 500 },
      "t"
    );
    r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    r.atualizar([], 300);
    expect(r.vivas).toHaveLength(1);
    // 501 ms sem observacao: expira no inicio da atualizacao.
    r.atualizar([], 501);
    expect(r.vivas).toHaveLength(0);
  });

  it("nao reutiliza o ID de uma entidade expirada por tempo", () => {
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.3, maxFramesAusente: 10, maxTempoAusenteMs: 500 },
      "t"
    );
    const antes = r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    const idAntes = antes[0].entidadeId;
    // A pessoa reaparece no mesmo lugar, mas depois da lacuna temporal.
    const depois = r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 900);
    expect(depois).toHaveLength(1);
    expect(depois[0].entidadeId).not.toBe(idAntes);
  });

  it("oclusao curta preserva o ID e atualiza a ultima observacao", () => {
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.3, maxFramesAusente: 5, maxTempoAusenteMs: 1000 },
      "t"
    );
    const a1 = r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    const id = a1[0].entidadeId;
    r.atualizar([], 100);
    r.atualizar([], 200);
    const voltou = r.atualizar([{ x: 0.52, y: 0.5, confianca: 0.9 }], 300);
    expect(voltou[0].entidadeId).toBe(id);
    expect(voltou[0].ultimaObservacaoMs).toBe(300);
    expect(voltou[0].framesAusente).toBe(0);
  });

  it("calcula velocidade normalizada por segundo e rejeita intervalos invalidos", () => {
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.3, maxFramesAusente: 5, maxTempoAusenteMs: 2000, alphaSuavizacao: 0.5 },
      "t"
    );
    r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    const a = r.atualizar([{ x: 0.6, y: 0.5, confianca: 0.9 }], 1000);
    // 0.1 de deslocamento em 1 s = 0.1/s (nao "0.1 por frame").
    expect(a[0].velocidade).toBeCloseTo(0.1);
    expect(a[0].velocidadeValida).toBe(true);
    expect(a[0].intervaloVelocidadeMs).toBe(1000);

    // Mesmo instante: intervalo invalido, sem velocidade presumida.
    const b = r.atualizar([{ x: 0.7, y: 0.5, confianca: 0.9 }], 1000);
    expect(b[0].velocidade).toBe(0);
    expect(b[0].velocidadeY).toBe(0);
    expect(b[0].velocidadeValida).toBe(false);
    expect(b[0].intervaloVelocidadeMs).toBeUndefined();
  });

  it("nao calcula velocidade atravessando uma lacuna longa", () => {
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.3, maxFramesAusente: 10, maxTempoAusenteMs: 500, alphaSuavizacao: 0.5 },
      "t"
    );
    const antes = r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 0);
    // 800 ms > 500 ms: a entidade expira e a nova observacao nao herda
    // continuidade nem velocidade da anterior.
    const depois = r.atualizar([{ x: 0.9, y: 0.5, confianca: 0.9 }], 800);
    expect(depois[0].entidadeId).not.toBe(antes[0].entidadeId);
    expect(depois[0].velocidade).toBe(0);
    expect(depois[0].velocidadeValida).toBe(false);
  });

  it("trajetorias proximas sem cruzamento preservam os IDs", () => {
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.2, maxFramesAusente: 5, maxTempoAusenteMs: 2000 },
      "t"
    );
    const a = r.atualizarComAssociacoes(
      [
        { x: 0.3, y: 0.5, confianca: 0.9 },
        { x: 0.7, y: 0.5, confianca: 0.9 },
      ],
      0
    );
    const idEsquerda = a.entidades.find((e) => e.x < 0.5)!.entidadeId;
    const idDireita = a.entidades.find((e) => e.x > 0.5)!.entidadeId;

    // Aproximam-se ate 0.1 de separacao, mas sem se cruzarem.
    const passos = [
      [0.35, 0.65],
      [0.4, 0.6],
      [0.42, 0.58],
      [0.45, 0.55],
    ];
    for (let i = 0; i < passos.length; i += 1) {
      const [x1, x2] = passos[i];
      const atual = r.atualizarComAssociacoes(
        [
          { x: x1, y: 0.5, confianca: 0.9 },
          { x: x2, y: 0.5, confianca: 0.9 },
        ],
        (i + 1) * 100
      );
      const porIndice = new Map(atual.associacoes.map((ass) => [ass.indice, ass.entidadeId]));
      expect(porIndice.get(0)).toBe(idEsquerda);
      expect(porIndice.get(1)).toBe(idDireita);
    }
  });

  it("cruzamento ambiguo expoe a limitacao do guloso (IDs podem trocar)", () => {
    // Documenta o comportamento atual, nao um contrato desejavel: quando duas
    // trajetorias se cruzam e a suavizacao fica atras do movimento, a menor
    // distancia pode associar cada entidade a pessoa oposta. O roteiro (P2.2)
    // pede IoU/Hungarian apenas se os dados mostrarem falha frequente — por
    // isso o teste fixa a limitacao em vez de escondela.
    const r = new RastreadorEntidades(
      { distanciaMaxima: 0.2, maxFramesAusente: 5, maxTempoAusenteMs: 2000 },
      "t"
    );
    const a = r.atualizarComAssociacoes(
      [
        { x: 0.3, y: 0.5, confianca: 0.9 },
        { x: 0.7, y: 0.5, confianca: 0.9 },
      ],
      0
    );
    const idEsquerda = a.entidades.find((e) => e.x < 0.5)!.entidadeId;
    const idDireita = a.entidades.find((e) => e.x > 0.5)!.entidadeId;

    const passos = [
      [0.35, 0.65],
      [0.4, 0.6],
      [0.45, 0.55],
      [0.55, 0.45],
    ];
    const associacoes: Array<Map<number, string>> = [];
    for (let i = 0; i < passos.length; i += 1) {
      const [x1, x2] = passos[i];
      const atual = r.atualizarComAssociacoes(
        [
          { x: x1, y: 0.5, confianca: 0.9 },
          { x: x2, y: 0.5, confianca: 0.9 },
        ],
        (i + 1) * 100
      );
      associacoes.push(new Map(atual.associacoes.map((ass) => [ass.indice, ass.entidadeId])));
    }

    // Antes do cruzamento os IDs seguem a trajetoria fisica.
    expect(associacoes[1].get(0)).toBe(idEsquerda);
    expect(associacoes[1].get(1)).toBe(idDireita);
    // No frame do cruzamento a associacao gulosa troca os IDs de sonda.
    const ultimo = associacoes[associacoes.length - 1];
    expect(ultimo.get(0)).toBe(idDireita);
    expect(ultimo.get(1)).toBe(idEsquerda);
  });
});

// ---------------------------------------------------------------------------
// Motor: lateralidade como restricao de associacao
// ---------------------------------------------------------------------------

describe("MotorTemporalImpl — lateralidade", () => {
  const mao = (
    lateralidade: "esquerda" | "direita" | "desconhecida",
    x: number
  ): NonNullable<ObservacaoFrame["maos"]>["maos"][number] => ({
    lateralidade,
    landmarks: [
      { x, y: 0.5 },
      { x: x + 0.02, y: 0.48 },
    ],
  });

  const idsPorLateralidade = (
    observacao: ObservacaoFrame
  ): Map<string, string | undefined> => {
    const ids = new Map<string, string | undefined>();
    if (estaIndisponivel(observacao.maos)) return ids;
    for (const detectada of observacao.maos.maos) {
      ids.set(detectada.lateralidade, detectada.entidadeId);
    }
    return ids;
  };

  it("cruzamento de maos nao troca IDs entre esquerda e direita", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r1 = motor.processar([
      obs({
        ms: 0,
        maos: { maos: [mao("esquerda", 0.4), mao("direita", 0.6)] },
      }),
    ]);
    const ids1 = idsPorLateralidade(r1.observacoes[0]);
    const idEsquerda = ids1.get("esquerda");
    const idDireita = ids1.get("direita");
    expect(idEsquerda).toBeDefined();
    expect(idDireita).toBeDefined();
    expect(idEsquerda).not.toBe(idDireita);

    // As trajetorias se cruzam: sem a restricao de lateralidade, o guloso
    // associaria cada mao ao probe mais proximo e trocaria os IDs.
    const r2 = motor.processar([
      obs({
        ms: 100,
        maos: { maos: [mao("esquerda", 0.55), mao("direita", 0.45)] },
      }),
    ]);
    const ids2 = idsPorLateralidade(r2.observacoes[0]);
    expect(ids2.get("esquerda")).toBe(idEsquerda);
    expect(ids2.get("direita")).toBe(idDireita);
  });

  it("lateralidade desconhecida nao bloqueia a associacao", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r1 = motor.processar([
      obs({
        ms: 0,
        maos: { maos: [mao("esquerda", 0.4), mao("direita", 0.6)] },
      }),
    ]);
    const idEsquerda = idsPorLateralidade(r1.observacoes[0]).get("esquerda");
    expect(idEsquerda).toBeDefined();

    // Sem evidencia de lateralidade nao ha como restringir: a mao herda o ID
    // da entidade esquerda, que esta mais proxima.
    const r2 = motor.processar([
      obs({ ms: 100, maos: { maos: [mao("desconhecida", 0.45)] } }),
    ]);
    expect(idsPorLateralidade(r2.observacoes[0]).get("desconhecida")).toBe(idEsquerda);
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

  it("diagnostico expoe o encerramento apenas no processamento em que ocorreu", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    m.processar([leitura("gesto_a", 1)]);
    m.processar([leitura("gesto_a", 2)]);
    m.processar([leitura(null, 3)]);
    // Antes de encerrar, o estado corrente e "ativo".
    const ativo = m.diagnosticos().find((d) => d.entidadeId === "e1");
    expect(ativo?.ativo).toBe(true);
    expect(ativo?.framesEvidencia).toBe(2);

    m.processar([leitura(null, 4)]); // encerra
    const encerrado = m.diagnosticos().find((d) => d.entidadeId === "e1");
    expect(encerrado?.ativo).toBe(false);
    expect(encerrado?.framesCandidato).toBe(0);
    expect(encerrado?.framesEvidencia).toBe(2);
    expect(encerrado?.motivoUltimaAusencia).toBe("sem_sinal");

    // O encerramento nao vira estado permanente: no proximo processamento, sem
    // novo ativo/candidato, nao ha diagnostico desse sinal.
    m.processar([leitura(null, 5)]);
    expect(m.diagnosticos().some((d) => d.entidadeId === "e1")).toBe(false);
  });

  it("fimEm e a ultima evidencia positiva, nunca o inicio nem o frame de ausencia", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });

    m.processar([leitura("gesto_a", 1)]);
    m.processar([leitura("gesto_a", 2)]);
    // Duas evidencias positivas adicionais (frames 3 e 4).
    m.processar([leitura("gesto_a", 3)]);
    m.processar([leitura("gesto_a", 4)]);
    // Ausencia: a referencia de tempo do encerramento deve continuar no frame 4.
    m.processar([leitura(null, 5)]);
    const encerrados = m.processar([leitura(null, 6)]);
    expect(encerrados).toHaveLength(1);
    const evento = encerrados[0];
    const inicio = Date.parse(evento.inicioEm);
    const fim = Date.parse(evento.fimEm!);
    expect(fim).toBeGreaterThan(inicio); // nao colapsa para o inicio
    expect(evento.fimEm).toBe(leitura("gesto_a", 4).timestamp);
    expect(evento.motivoEncerramento).toBe("sem_sinal");
    // Evidencia positiva parou no frame 4; a entidade continuou sendo
    // observada (sem sinal) ate o frame 6, quando o evento encerrou.
    expect(evento.ultimaEvidenciaEm).toBe(leitura("gesto_a", 4).timestamp);
    expect(evento.ultimaObservacaoEm).toBe(leitura(null, 6).timestamp);
    expect(Date.parse(evento.ultimaObservacaoEm!)).toBeGreaterThan(
      Date.parse(evento.ultimaEvidenciaEm!)
    );
  });

  it("leitura sem sinal de entidade ainda no rastreador nao avanca a observacao", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number, observada = true) => ({
      entidadeId: "e1",
      rotulo,
      confianca: rotulo === null ? 0 : 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
      observada,
    });

    m.processar([leitura("gesto_a", 1)]);
    m.processar([leitura("gesto_a", 2)]);
    m.processar([leitura("gesto_a", 3)]);
    // Frame 4: entidade nao foi vista, mas o rastreador ainda a mantem.
    expect(m.processar([leitura(null, 4, false)])).toHaveLength(0);
    const encerrados = m.processar([leitura(null, 5, false)]);
    expect(encerrados).toHaveLength(1);
    expect(encerrados[0].ultimaEvidenciaEm).toBe(leitura("gesto_a", 3).timestamp);
    // A observacao nao avancou para frames sem a entidade.
    expect(encerrados[0].ultimaObservacaoEm).toBe(leitura("gesto_a", 3).timestamp);
  });

  it("evento nunca termina antes de comecar (duracao nao negativa)", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 1, framesParaEncerrar: 1 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: frame === 1 ? "2024-01-01T00:00:01.000Z" : "2024-01-01T00:00:00.000Z",
      cycleId: "c1",
    });
    const confirmados = m.processar([leitura("gesto_a", 1)]);
    expect(confirmados[0].estado).toBe("confirmado");
    // Frame seguinte com timestamp ANTERIOR (relogio fora de ordem).
    const encerrados = m.processar([leitura(null, 2)]);
    expect(encerrados).toHaveLength(1);
    expect(Date.parse(encerrados[0].fimEm!)).toBeGreaterThanOrEqual(
      Date.parse(encerrados[0].inicioEm)
    );
  });

  it("entidade desaparece do frame: fim usa a ultima evidencia, nao o inicio", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 1 });
    const leitura = (frame: number) => ({
      entidadeId: "e1",
      rotulo: "gesto_a",
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });
    m.processar([leitura(1)]);
    m.processar([leitura(2)]);
    m.processar([leitura(3)]);
    // Proximo frame: sem leitura alguma para a entidade (sumiu do frame).
    const encerrados = m.processar([]);
    expect(encerrados).toHaveLength(1);
    expect(encerrados[0].fimEm).toBe(leitura(3).timestamp);
    expect(encerrados[0].ultimaEvidenciaEm).toBe(leitura(3).timestamp);
    // Sumiu do frame: a ultima observacao e a ultima vez que foi vista.
    expect(encerrados[0].ultimaObservacaoEm).toBe(leitura(3).timestamp);
    expect(Date.parse(encerrados[0].fimEm!)).toBeGreaterThan(Date.parse(encerrados[0].inicioEm));
  });

  it("inferencia indisponivel preserva ativo e reinicia candidatos", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    // Candidato de 1 frame, depois falha de inferencia: candidato reinicia.
    m.processar([leitura("gesto_a", 1)]);
    expect(m.processar([], { indisponivel: true })).toHaveLength(0);
    // Um unico frame valido nao confirma (candidato foi descartado).
    expect(m.processar([leitura("gesto_a", 2)])).toHaveLength(0);
    const confirmados = m.processar([leitura("gesto_a", 3)]);
    expect(confirmados).toHaveLength(1);
    expect(confirmados[0].estado).toBe("confirmado");

    // Com o evento ativo, uma falha de inferencia NAO encerra.
    expect(m.processar([], { indisponivel: true })).toHaveLength(0);
    expect(m.estaAtivo("e1")).toBe(true);
    // Recuperacao: sinal volta a ser observado, evento continua o mesmo.
    expect(m.processar([leitura("gesto_a", 4)])).toHaveLength(0);
    expect(m.estaAtivo("e1")).toBe(true);
  });

  it("interromperPorPeriodoCego encerra na ultima evidencia com motivo e lacuna", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (frame: number) => ({
      entidadeId: "e1",
      rotulo: "gesto_a",
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });
    // Entidade desconhecida nao esta ativa.
    expect(m.estaAtivo("inexistente")).toBe(false);

    m.processar([leitura(1)]);
    m.processar([leitura(2)]);
    m.processar([leitura(3)]);

    const interrompidos = m.interromperPorPeriodoCego(4000);
    expect(interrompidos).toHaveLength(1);
    expect(interrompidos[0].estado).toBe("encerrado");
    expect(interrompidos[0].motivoEncerramento).toBe("periodo_cego");
    expect(interrompidos[0].intervaloSemObservacaoMs).toBe(4000);
    expect(interrompidos[0].fimEm).toBe(leitura(3).timestamp);
    expect(m.estaAtivo("e1")).toBe(false);
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

describe("MotorTemporalImpl — rastreamento de pessoas", () => {
  it("mudanca brusca de postura nao troca o ID (referencia no torso)", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      // Limiar curto: se a referencia fosse o centroide de todos os keypoints,
      // os membros em posicoes opostas mudariam o centro e criariam outro track.
      rastreador: { distanciaMaxima: 0.05, maxFramesAusente: 5, alphaSuavizacao: 0.6 },
    });
    const poseComMembros = (yMembros: number): ObservacaoFrame["pose"] => {
      const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
        x: 0.5,
        y: yMembros,
        confianca: 0.9,
      }));
      // Torso fixo: ombros (5/6) e quadris (11/12).
      pontos[5] = { x: 0.45, y: 0.4, confianca: 0.9 };
      pontos[6] = { x: 0.55, y: 0.4, confianca: 0.9 };
      pontos[11] = { x: 0.45, y: 0.6, confianca: 0.9 };
      pontos[12] = { x: 0.55, y: 0.6, confianca: 0.9 };
      return { pessoas: [{ pontos, confianca: 0.9 } as PessoaPose] };
    };

    motor.processar([obs({ ms: 0, pose: poseComMembros(0.15) })]);
    const id = motor.pessoasVivas[0]?.entidadeId;
    expect(id).toBeDefined();

    // Bracos, cabeca e pernas saltam entre extremos; o torso nao se move.
    for (let i = 0; i < 4; i += 1) {
      motor.processar([
        obs({ ms: (i + 1) * 100, pose: poseComMembros(i % 2 === 0 ? 0.85 : 0.15) }),
      ]);
      expect(motor.pessoasVivas).toHaveLength(1);
      expect(motor.pessoasVivas[0].entidadeId).toBe(id);
    }
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

  it("geometria sem rotulo do modelo reconhece mao aberta", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, maos: { maos: [maoGeometrica()] } })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado).toBeDefined();
    expect(confirmado?.descricao).toContain("mao_aberta");
    // A origem continua sendo maos; a evidencia concreta fica registrada.
    expect(confirmado?.origens).toEqual(["maos"]);
    expect(confirmado?.evidencias?.some((e) => e.startsWith("geometria:"))).toBe(true);
    expect(confirmado?.confianca).toBeLessThanOrEqual(0.9);
  });

  it("mão ocultada encerra o gesto por oclusao, nao por 'sem sinal'", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const confirmado = r2.eventos.find((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado");
    expect(confirmado).toBeDefined();

    // Mao oculta por 2 frames (>= framesParaEncerrar).
    const r3 = motor.processar([obs({ ms: 200, maos: { maos: [] } })]);
    expect(
      r3.diagnosticos?.some(
        (d) => d.sinal === "gesto" && d.estado === "ocluido"
      )
    ).toBe(true);
    const r4 = motor.processar([obs({ ms: 300, maos: { maos: [] } })]);
    const encerrado = r4.eventos.find((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado");
    expect(encerrado).toBeDefined();
    expect(encerrado?.eventoId).toBe(confirmado?.eventoId);
    expect(encerrado?.fimEm).toBeDefined();
    expect(encerrado?.motivoEncerramento).toBe("oclusao");
    // A continuidade ate a ultima evidencia era valida; a oclusao explica o fim.
    expect(encerrado?.continuidadeValida).toBe(true);
    // O diagnostico do ciclo distingue o encerramento do estado "ocluido".
    const diagEncerrado = r4.diagnosticos?.find((d) => d.sinal === "gesto");
    expect(diagEncerrado?.estado).toBe("encerrado");
    expect(diagEncerrado?.motivoEncerramento).toBe("oclusao");
    // duracao = fim - inicio (300 - 0 = 300ms apos normalizar epoch).
    const dur = Date.parse(encerrado!.fimEm!) - Date.parse(encerrado!.inicioEm);
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it("mao visivel sem gesto encerra como 'sem sinal'", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    expect(
      r2.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(true);

    const semGesto: ObservacaoFrame["maos"] = {
      maos: [{ lateralidade: "direita", landmarks: [{ x: 0.5, y: 0.4 }] }],
    };
    motor.processar([obs({ ms: 200, maos: semGesto })]);
    const r4 = motor.processar([obs({ ms: 300, maos: semGesto })]);
    const encerrado = r4.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "encerrado"
    );
    expect(encerrado?.motivoEncerramento).toBe("sem_sinal");
    expect(encerrado?.ultimaObservacaoEm).toBe(
      new Date(1700000000000 + 300).toISOString()
    );
  });

  it("observacao insuficiente nao confirma e aparece no diagnostico", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r = motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    expect(
      r.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(false);
    const diag = r.diagnosticos?.find((d) => d.sinal === "gesto");
    expect(diag?.estado).toBe("observacao_insuficiente");
    expect(diag?.framesEvidencia).toBe(1);
  });

  it("inferencia indisponivel preserva o gesto e aparece no diagnostico", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const r = motor.processar([
      obs({ ms: 200, maos: indisponivel("maos", "timeout") }),
    ]);
    expect(r.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado")).toBe(
      false
    );
    const diag = r.diagnosticos?.find((d) => d.sinal === "gesto");
    expect(diag?.estado).toBe("inferencia_indisponivel");
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
