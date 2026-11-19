import { describe, expect, it } from "vitest";
import { RastreadorEntidades } from "../public/temporal/rastreador-entidades";

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

  it("reassocia entidade perdida dentro da janela e preserva o ID", () => {
    const r = new RastreadorEntidades(
      {
        distanciaMaxima: 0.1,
        distanciaReassociacaoMaxima: 0.4,
        maxFramesAusente: 1,
        maxTempoAusenteMs: 1000,
        alphaSuavizacao: 0.5,
      },
      "t"
    );
    const a1 = r.atualizarComAssociacoes([{ x: 0.2, y: 0.5, confianca: 0.9 }], 0);
    const id = a1.entidades[0].entidadeId;
    expect(a1.entidades[0].estado).toBe("ativa");

    // Dois frames ausentes: o track sai da janela ativa para o buffer.
    r.atualizarComAssociacoes([], 100);
    r.atualizarComAssociacoes([], 200);
    expect(r.vivas).toHaveLength(0);
    expect(r.perdidas).toHaveLength(1);
    expect(r.perdidas[0].estado).toBe("perdida");

    // 0.15 de distancia > distanciaMaxima (0.1), mas <= reassociacao (0.4).
    const voltou = r.atualizarComAssociacoes([{ x: 0.35, y: 0.5, confianca: 0.9 }], 300);
    expect(voltou.entidades[0].entidadeId).toBe(id);
    expect(voltou.entidades[0].estado).toBe("ativa");
    expect(voltou.entidades[0].reassociacoes).toBe(1);
    // A lacuna nao vira movimento: sem velocidade/deslocamento presumidos.
    expect(voltou.entidades[0].velocidade).toBe(0);
    expect(voltou.entidades[0].velocidadeValida).toBe(false);
    expect(voltou.entidades[0].deslocamento).toBe(0);
    expect(r.perdidas).toHaveLength(0);
  });

  it("nao reassocia alem do raio de reassociacao", () => {
    const r = new RastreadorEntidades(
      {
        distanciaMaxima: 0.1,
        distanciaReassociacaoMaxima: 0.2,
        maxFramesAusente: 1,
        maxTempoAusenteMs: 1000,
      },
      "t"
    );
    const a1 = r.atualizar([{ x: 0.2, y: 0.5, confianca: 0.9 }], 0);
    const id = a1[0].entidadeId;
    r.atualizar([], 100);
    r.atualizar([], 200);

    const novo = r.atualizar([{ x: 0.5, y: 0.5, confianca: 0.9 }], 300);
    expect(novo[0].entidadeId).not.toBe(id);
    expect(r.perdidas).toHaveLength(1); // continua perdida ate expirar por tempo
  });

  it("nao reassocia depois de expirar por tempo", () => {
    const r = new RastreadorEntidades(
      {
        distanciaMaxima: 0.1,
        distanciaReassociacaoMaxima: 0.4,
        maxFramesAusente: 1,
        maxTempoAusenteMs: 500,
      },
      "t"
    );
    const a1 = r.atualizar([{ x: 0.2, y: 0.5, confianca: 0.9 }], 0);
    const id = a1[0].entidadeId;
    r.atualizar([], 100);
    r.atualizar([], 200);
    expect(r.perdidas).toHaveLength(1);

    // 600 ms > 500 ms: a perdida expira antes de a sonda reaparecer.
    const novo = r.atualizar([{ x: 0.35, y: 0.5, confianca: 0.9 }], 600);
    expect(novo[0].entidadeId).not.toBe(id);
    expect(r.perdidas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
