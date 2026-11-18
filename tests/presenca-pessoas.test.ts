import { describe, expect, it } from "vitest";
import {
  DetectorPresencaPessoas,
  type AmostraPresenca,
  type ReferenciaFramePresenca,
} from "../public/temporal/presenca-pessoas";

const BASE_MS = 1_700_000_000_000;

const iso = (ms: number) => new Date(BASE_MS + ms).toISOString();

function amostra(
  parte: Partial<AmostraPresenca> & { entidadeId: string; frameId: string; ms: number }
): AmostraPresenca {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    timestamp: iso(parte.ms),
    tempoMs: parte.ms,
    observado: true,
    continuidadeValida: true,
    confianca: 0.9,
    fonteReferencia: "torso",
    ...parte,
  };
}

function referencia(ms: number, frameId = `f-ref-${ms}`): ReferenciaFramePresenca {
  return { sessionId: "s1", cycleId: "s1-c1", frameId, timestamp: iso(ms), tempoMs: ms };
}

describe("DetectorPresencaPessoas", () => {
  it("emite uma aparicao so apos a histerese de entrada", () => {
    const detector = new DetectorPresencaPessoas();
    const primeiro = detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f1", ms: 0 })],
      referencia(0, "f1")
    );
    expect(primeiro).toHaveLength(0);

    const eventos = detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f2", ms: 100 })],
      referencia(100, "f2")
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: "aparicao",
      estado: "confirmado",
      sessionId: "s1",
      cycleId: "s1-c1",
      entidadeId: "pes-1",
      origens: ["pose"],
      inicioEm: iso(100),
      ultimaEvidenciaEm: iso(100),
      ultimaObservacaoEm: iso(100),
      frameIds: ["f2"],
      motivoEncerramento: "ponto",
      confianca: 0.9,
      continuidadeValida: true,
    });
  });

  it("oclusao curta nao gera saida; saida usa a ultima evidencia positiva", () => {
    const detector = new DetectorPresencaPessoas();
    detector.processar([amostra({ entidadeId: "pes-1", frameId: "f1", ms: 0 })], referencia(0, "f1"));
    detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f2", ms: 100 })],
      referencia(100, "f2")
    );

    const ausente = (frameId: string, ms: number) =>
      amostra({ entidadeId: "pes-1", frameId, ms, observado: false });

    expect(
      detector.processar([ausente("f3", 200)], referencia(200, "f3"))
    ).toHaveLength(0);
    expect(
      detector.processar([ausente("f4", 300)], referencia(300, "f4"))
    ).toHaveLength(0);

    const eventos = detector.processar(
      [ausente("f5", 400)],
      referencia(400, "f5")
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: "desaparecimento",
      estado: "confirmado",
      entidadeId: "pes-1",
      origens: ["pose"],
      inicioEm: iso(400),
      ultimaEvidenciaEm: iso(100),
      ultimaObservacaoEm: iso(400),
      frameIds: ["f5"],
      motivoEncerramento: "oclusao",
    });
    expect(
      detector.processar([ausente("f6", 500)], referencia(500, "f6"))
    ).toHaveLength(0);
  });

  it("falha de inferencia congela a presenca sem contar como ausencia", () => {
    const detector = new DetectorPresencaPessoas();
    detector.processar([amostra({ entidadeId: "pes-1", frameId: "f1", ms: 0 })], referencia(0, "f1"));
    expect(
      detector.processar([], referencia(100, "f2"), { indisponivel: true })
    ).toHaveLength(0);
    expect(detector.estados()).toMatchObject([
      { entidadeId: "pes-1", framesObservado: 1, framesSemSinal: 0 },
    ]);

    const eventos = detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f3", ms: 200 })],
      referencia(200, "f3")
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0].tipo).toBe("aparicao");
  });

  it("periodo cego encerra como incerto sem afirmar saida", () => {
    const detector = new DetectorPresencaPessoas();
    detector.processar([amostra({ entidadeId: "pes-1", frameId: "f1", ms: 0 })], referencia(0, "f1"));
    detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f2", ms: 100 })],
      referencia(100, "f2")
    );
    const eventos = detector.interromperPorPeriodoCego(1_400);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: "desaparecimento",
      estado: "incerto",
      entidadeId: "pes-1",
      inicioEm: iso(100),
      ultimaEvidenciaEm: iso(100),
      frameIds: ["f2"],
      intervaloSemObservacaoMs: 1_400,
      motivoEncerramento: "periodo_cego",
      continuidadeValida: false,
    });
    expect(detector.estados()).toEqual([]);
  });

  it("monitora tracks independentes e usa o frame de referencia quando um some", () => {
    const detector = new DetectorPresencaPessoas();
    const par = [
      amostra({ entidadeId: "pes-1", frameId: "f1", ms: 0 }),
      amostra({ entidadeId: "pes-2", frameId: "f1", ms: 0 }),
    ];
    detector.processar(par, referencia(0, "f1"));
    const entradas = detector.processar(
      [
        amostra({ entidadeId: "pes-1", frameId: "f2", ms: 100 }),
        amostra({ entidadeId: "pes-2", frameId: "f2", ms: 100 }),
      ],
      referencia(100, "f2")
    );
    expect(entradas.map((evento) => evento.entidadeId).sort()).toEqual(["pes-1", "pes-2"]);

    // pes-2 desaparece das amostras (track expirado); pes-1 continua visivel.
    detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f3", ms: 200 })],
      referencia(200, "f3")
    );
    detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f4", ms: 300 })],
      referencia(300, "f4")
    );
    const saidas = detector.processar(
      [amostra({ entidadeId: "pes-1", frameId: "f5", ms: 400 })],
      referencia(400, "f5")
    );
    expect(saidas).toHaveLength(1);
    expect(saidas[0]).toMatchObject({
      tipo: "desaparecimento",
      entidadeId: "pes-2",
      inicioEm: iso(400),
      ultimaEvidenciaEm: iso(100),
      frameIds: ["f5"],
    });
  });
});
