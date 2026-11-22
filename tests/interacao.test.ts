import { describe, expect, it } from "vitest";
import {
  DetectorInteracao,
  type AmostraInteracao,
} from "../public/temporal/interacao";
import type { EventoTemporal } from "../src/domain";

/**
 * Eventos de interacao mão↔objeto (Fase 4). Tudo e determinístico: o relogio
 * vem de `tempoMs`/`timestamp` da amostra, nunca do relogio de parede.
 */
const BASE = 1_700_000_000_000;
const iso = (ms: number) => new Date(BASE + ms).toISOString();

function amostra(overrides: Partial<AmostraInteracao> = {}): AmostraInteracao {
  return {
    sessionId: "s1",
    maoEntidadeId: "mao-1",
    objetoEntidadeId: "obj-1",
    rotuloObjeto: "garrafa",
    // Punho dentro da caixa: centro (0.5, 0.5).
    punhoMao: { x: 0.5, y: 0.5 },
    caixaObjeto: { xmin: 0.45, ymin: 0.45, xmax: 0.55, ymax: 0.55 },
    confianca: 0.9,
    frameId: "f0",
    timestamp: iso(0),
    tempoMs: 0,
    cycleId: "c1",
    observado: true,
    continuidadeValida: true,
    ...overrides,
  };
}

function sequencia(
  quantidade: number,
  gerar: (i: number) => Partial<AmostraInteracao> = () => ({})
): AmostraInteracao[] {
  return Array.from({ length: quantidade }, (_, i) =>
    amostra({
      frameId: `f${i}`,
      timestamp: iso(i * 100),
      tempoMs: i * 100,
      ...gerar(i),
    })
  );
}

function estados(eventos: EventoTemporal[]): string[] {
  return eventos.map((e) => e.estado);
}

describe("DetectorInteracao", () => {
  it("proximidade sustentada sem sobreposicao fica no maximo em provavel", () => {
    const detector = new DetectorInteracao();
    // Punho a 0.1 do centro (dentro do raio 0.15), mas fora da caixa
    // [0.45, 0.55] com margem 0.02 -> nao ha sobreposicao.
    const eventos = detector.processar(
      sequencia(6, () => ({ punhoMao: { x: 0.6, y: 0.5 } }))
    );
    expect(estados(eventos)).toEqual(["incerto", "provavel"]);
    expect(eventos.some((e) => e.estado === "confirmado")).toBe(false);
    expect(eventos.at(-1)?.descricao).toMatch(/contato nao confirmado/);
  });

  it("sobreposicao sustentada sem mudanca do objeto tambem fica em provavel", () => {
    const detector = new DetectorInteracao();
    const eventos = detector.processar(sequencia(6));
    expect(estados(eventos)).toEqual(["incerto", "provavel"]);
    expect(eventos.some((e) => e.estado === "confirmado")).toBe(false);
    expect(eventos.at(-1)?.evidencias).toContain("sobreposicao:punho_na_caixa");
  });

  it("sobreposicao sustentada + objeto em movimento confirma o contato", () => {
    const detector = new DetectorInteracao();
    // A partir de f2 o objeto se desloca 0.05 normalizado; o punho continua
    // dentro da caixa (agora centrada em x=0.60).
    const eventos = detector.processar(
      sequencia(4, (i) =>
        i >= 2
          ? { caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 } }
          : {}
      )
    );
    expect(estados(eventos)).toEqual(["incerto", "provavel", "confirmado"]);
    const confirmado = eventos.at(-1)!;
    expect(confirmado.tipo).toBe("interacao_objeto");
    expect(confirmado.descricao).toMatch(/Contato confirmado/);
    expect(confirmado.evidencias?.some((e) => e.startsWith("objeto_moveu:"))).toBe(true);
    expect(confirmado.origens).toEqual(["maos", "objetos"]);
    expect(confirmado.participantes).toEqual(["mao-1", "obj-1"]);
    expect(confirmado.entidadeId).toBe("obj-1");
    expect(confirmado.frameIds).toEqual(["f0", "f1", "f2"]);
  });

  it("todos os graus compartilham o mesmo eventoId", () => {
    const detector = new DetectorInteracao();
    const eventos = detector.processar(
      sequencia(4, (i) =>
        i >= 2
          ? { caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 } }
          : {}
      )
    );
    expect(new Set(eventos.map((e) => e.eventoId)).size).toBe(1);
  });

  it("movimento com intervalo invalido ou continuidade quebrada nao confirma", () => {
    const detector = new DetectorInteracao();
    const amostras = sequencia(4, (i) =>
      i >= 2
        ? {
            caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 },
            // Intervalo de 5 s excede `intervaloMaximoMs` (2 s).
            tempoMs: i * 5000,
            timestamp: iso(i * 5000),
          }
        : {}
    );
    const eventos = detector.processar(amostras);
    expect(eventos.some((e) => e.estado === "confirmado")).toBe(false);
    expect(estados(eventos)).toContain("provavel");
  });

  it("continuidade invalida limita o grau a incerto", () => {
    const detector = new DetectorInteracao();
    const eventos = detector.processar(
      sequencia(5, () => ({ continuidadeValida: false }))
    );
    expect(estados(eventos)).toEqual(["incerto"]);
  });

  it("amostras abaixo da confianca minima nao viram evento", () => {
    const detector = new DetectorInteracao();
    expect(detector.processar(sequencia(5, () => ({ confianca: 0.3 })))).toEqual([]);
  });

  it("encerra no ultimo instante de evidencia quando a mao se afasta", () => {
    const detector = new DetectorInteracao();
    const proximas = detector.processar(sequencia(2));
    expect(estados(proximas)).toEqual(["incerto", "provavel"]);
    const afastadas = detector.processar(
      sequencia(3, (i) => ({
        frameId: `g${i}`,
        timestamp: iso(1000 + i * 100),
        tempoMs: 1000 + i * 100,
        punhoMao: { x: 0.9, y: 0.9 },
      }))
    );
    expect(estados(afastadas)).toEqual(["encerrado"]);
    const encerrado = afastadas[0];
    expect(encerrado.motivoEncerramento).toBe("sem_sinal");
    expect(encerrado.fimEm).toBe(iso(100));
    expect(encerrado.eventoId).toBe(proximas[0].eventoId);
    expect(encerrado.descricao).toMatch(/grau maximo: provavel/);
  });

  it("ausencia do par fecha por oclusao sem apagar a evidencia anterior", () => {
    const detector = new DetectorInteracao();
    const proximas = detector.processar(sequencia(2));
    const semPar: EventoTemporal[] = [];
    for (let i = 0; i < 3; i += 1) {
      semPar.push(...detector.processar([]));
    }
    expect(estados(semPar)).toEqual(["encerrado"]);
    expect(semPar[0].motivoEncerramento).toBe("oclusao");
    expect(semPar[0].frameIds).toEqual(["f0", "f1"]);
    expect(semPar[0].eventoId).toBe(proximas[0].eventoId);
  });

  it("periodo cego encerra como incerto sem presumir continuidade", () => {
    const detector = new DetectorInteracao();
    detector.processar(sequencia(2));
    const interrompidos = detector.interromperPorPeriodoCego(3000);
    expect(interrompidos).toHaveLength(1);
    expect(interrompidos[0]).toMatchObject({
      estado: "incerto",
      motivoEncerramento: "periodo_cego",
      intervaloSemObservacaoMs: 3000,
      continuidadeValida: false,
    });
    // Um frame depois da lacuna comeca um evento novo, nao reusa o id.
    const novo = detector.processar(
      sequencia(1, () => ({ frameId: "novo", timestamp: iso(5000), tempoMs: 5000 }))
    );
    expect(novo).toHaveLength(1);
    expect(novo[0].eventoId).not.toBe(interrompidos[0].eventoId);
  });

  it("inferencia indisponivel congela o estado sem inventar ausencia", () => {
    const detector = new DetectorInteracao();
    detector.processar(sequencia(2));
    for (let i = 0; i < 5; i += 1) {
      expect(detector.processar([], { indisponivel: true })).toEqual([]);
    }
    const retomada = detector.processar(
      sequencia(1, () => ({ frameId: "f2", timestamp: iso(200), tempoMs: 200 }))
    );
    expect(retomada).toEqual([]); // ja estava em `provavel`; sem escalada.
    expect(detector.estados()[0]).toMatchObject({
      grau: "provavel",
      framesProximidade: 3,
    });
  });

  it("pares diferentes tem identidades e historicos independentes", () => {
    const detector = new DetectorInteracao();
    const eventos = detector.processar([
      ...sequencia(3, () => ({ maoEntidadeId: "mao-esq", objetoEntidadeId: "obj-a" })),
      ...sequencia(3, () => ({
        maoEntidadeId: "mao-dir",
        objetoEntidadeId: "obj-b",
        frameId: "d0",
      })),
    ]);
    const porPar = new Map<string, EventoTemporal[]>();
    for (const evento of eventos) {
      const chave = evento.participantes?.join("|") ?? "?";
      porPar.set(chave, [...(porPar.get(chave) ?? []), evento]);
    }
    expect(porPar.size).toBe(2);
    expect([...porPar.values()].map((lista) => lista.at(-1)?.estado)).toEqual([
      "provavel",
      "provavel",
    ]);
    expect(new Set(eventos.map((e) => e.eventoId)).size).toBe(2);
  });

  it("limpar() reinicia todos os pares", () => {
    const detector = new DetectorInteracao();
    detector.processar(sequencia(2));
    expect(detector.estados()).toHaveLength(1);
    detector.limpar();
    expect(detector.estados()).toEqual([]);
  });

  it("serializa pessoa, natureza e pego no primeiro confirmado", () => {
    const detector = new DetectorInteracao();
    const eventos = detector.processar(
      sequencia(4, (i) => ({
        pessoaEntidadeId: "pessoa-1",
        ...(i >= 2
          ? { caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 } }
          : {}),
      }))
    );
    const confirmado = eventos.at(-1)!;
    expect(confirmado).toMatchObject({
      estado: "confirmado",
      pessoaEntidadeId: "pessoa-1",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "pego",
    });
    expect(confirmado.estadoAnterior).toBeUndefined();
    expect(confirmado.estadoPosterior).toBeUndefined();
  });

  it("um frame ambíguo não apaga a pessoa já associada", () => {
    const detector = new DetectorInteracao();
    const eventos = detector.processar(
      sequencia(4, (i) => ({
        pessoaEntidadeId: i === 3 ? undefined : "pessoa-1",
        ...(i >= 2
          ? { caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 } }
          : {}),
      }))
    );
    expect(eventos.at(-1)?.pessoaEntidadeId).toBe("pessoa-1");
  });

  it("marca deixado somente quando o objeto permanece estavel após o afastamento", () => {
    const detector = new DetectorInteracao();
    detector.processar(
      sequencia(4, (i) =>
        i >= 2 ? { caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 } } : {}
      )
    );
    const afastadas = detector.processar(
      sequencia(3, (i) => ({
        frameId: `g${i}`,
        timestamp: iso(1000 + i * 100),
        tempoMs: 1000 + i * 100,
        punhoMao: { x: 0.9, y: 0.9 },
        caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 },
      }))
    );
    expect(afastadas.at(-1)).toMatchObject({
      estado: "encerrado",
      motivoEncerramento: "sem_sinal",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "deixado",
    });
  });

  it("oclusão não gera deixado nem estado físico", () => {
    const detector = new DetectorInteracao();
    detector.processar(
      sequencia(4, (i) =>
        i >= 2 ? { caixaObjeto: { xmin: 0.5, ymin: 0.45, xmax: 0.7, ymax: 0.55 } } : {}
      )
    );
    const semPar: EventoTemporal[] = [];
    for (let i = 0; i < 3; i += 1) semPar.push(...detector.processar([]));
    expect(semPar.at(-1)).toMatchObject({ estado: "encerrado", motivoEncerramento: "oclusao" });
    expect(semPar.at(-1)?.transicaoPosse).toBeUndefined();
    expect(semPar.at(-1)?.estadoAnterior).toBeUndefined();
    expect(semPar.at(-1)?.estadoPosterior).toBeUndefined();
  });
});
