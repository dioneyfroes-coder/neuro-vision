import { describe, expect, it } from "vitest";
import {
  DURACAO_SEGMENTO_PADRAO_MS,
  QuadroRejeitadoError,
  type QuadroGravado,
  type VideoSegment,
} from "../src/domain";
import { GerenciadorGravacao } from "../src/monitoramento/gerenciador-gravacao";
import { BufferCircularQuadros } from "../src/monitoramento/buffer-circular";

/**
 * Gravacao segmentada e buffer pre-evento (Fase 3).
 *
 * Os testes usam timestamps sinteticos e explicitos: o gerenciador nao le o
 * relogio, entao a mesma sequencia sempre produz os mesmos segmentos.
 */

const BASE = 1_700_000_000_000;

function quadro(frameId: string, offsetMs: number): QuadroGravado {
  return { frameId, capturadoEmMs: BASE + offsetMs };
}

function motivoRejeicao(acao: () => unknown): string | undefined {
  try {
    acao();
  } catch (erro) {
    return erro instanceof QuadroRejeitadoError ? erro.motivo : undefined;
  }
  return undefined;
}

function sequencias(segmentos: VideoSegment[]): number[] {
  return segmentos.map((segmento) => segmento.sequencia);
}

describe("GerenciadorGravacao - rotacao", () => {
  it("rotaciona no limite exato sem perder nem sobrepor quadros", () => {
    const gerenciador = new GerenciadorGravacao({
      duracaoSegmentoMs: 1000,
      limiarLacunaMs: 2000,
    });
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE });

    const atribuicoes = [
      gerenciador.quadro(quadro("f0", 0)),
      gerenciador.quadro(quadro("f1", 400)),
      gerenciador.quadro(quadro("f2", 900)),
      gerenciador.quadro(quadro("f3", 1000)),
      gerenciador.quadro(quadro("f4", 1500)),
      gerenciador.quadro(quadro("f5", 2000)),
      gerenciador.quadro(quadro("f6", 2100)),
    ];

    expect(atribuicoes.map((a) => a.sequenciaSegmento)).toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(atribuicoes.map((a) => a.offsetMs)).toEqual([0, 400, 900, 0, 500, 0, 100]);

    gerenciador.encerrar(BASE + 2500);
    const segmentos = gerenciador.listarSegmentos();

    expect(segmentos).toHaveLength(3);
    expect(segmentos[0]).toMatchObject({
      sequencia: 1,
      inicioMs: BASE,
      fimMs: BASE + 1000,
      duracaoMs: 1000,
      quadros: 3,
      estado: "fechado",
      motivoFim: "duracao",
    });
    expect(segmentos[1]).toMatchObject({
      sequencia: 2,
      inicioMs: BASE + 1000,
      fimMs: BASE + 2000,
      duracaoMs: 1000,
      quadros: 2,
      estado: "fechado",
      motivoFim: "duracao",
    });
    // Encerramento usa o ultimo quadro, nunca o instante do comando.
    expect(segmentos[2]).toMatchObject({
      sequencia: 3,
      inicioMs: BASE + 2000,
      fimMs: BASE + 2100,
      quadros: 2,
      estado: "fechado",
      motivoFim: "sessao_encerrada",
    });

    for (let i = 1; i < segmentos.length; i += 1) {
      expect(segmentos[i].inicioMs).toBe(segmentos[i - 1].fimMs);
    }
  });

  it("evento no limite referencia os dois segmentos e o timestamp pertence ao posterior", () => {
    const gerenciador = new GerenciadorGravacao({
      duracaoSegmentoMs: 1000,
      limiarLacunaMs: 2000,
    });
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE });
    gerenciador.quadro(quadro("f0", 0));
    gerenciador.quadro(quadro("f1", 900));
    gerenciador.quadro(quadro("f2", 1000));
    gerenciador.quadro(quadro("f3", 1200));
    gerenciador.encerrar(BASE + 1300);

    expect(sequencias(gerenciador.segmentosParaIntervalo(BASE + 1000, BASE + 1000))).toEqual([
      1, 2,
    ]);
    expect(sequencias(gerenciador.segmentosParaIntervalo(BASE + 999, BASE + 1001))).toEqual([
      1, 2,
    ]);
    expect(gerenciador.segmentoParaTimestamp(BASE + 999)?.sequencia).toBe(1);
    expect(gerenciador.segmentoParaTimestamp(BASE + 1000)?.sequencia).toBe(2);
    // Depois do ultimo quadro nao ha cobertura inventada ate o encerramento.
    expect(gerenciador.segmentoParaTimestamp(BASE + 1300)).toBeUndefined();
    expect(gerenciador.segmentosParaIntervalo(BASE + 1201, BASE + 1300)).toEqual([]);
  });

  it("sessao longa de 30 minutos gera 6 segmentos de 5 minutos", () => {
    const gerenciador = new GerenciadorGravacao({ limiarLacunaMs: 60_000 });
    gerenciador.iniciar({ ambiente: "garagem", agoraMs: BASE });

    // Um quadro a cada 10 s, ate 29 min 50 s. Os quadros exatamente nos
    // limites (5, 10, ... min) abrem o segmento seguinte com offset 0.
    const totalQuadros = 180;
    for (let i = 0; i < totalQuadros; i += 1) {
      gerenciador.quadro(quadro(`f${i}`, i * 10_000));
    }
    gerenciador.encerrar(BASE + DURACAO_SEGMENTO_PADRAO_MS * 6);

    const segmentos = gerenciador.listarSegmentos();
    expect(segmentos).toHaveLength(6);
    expect(segmentos.map((segmento) => segmento.quadros)).toEqual([30, 30, 30, 30, 30, 30]);
    expect(segmentos.reduce((total, segmento) => total + segmento.quadros, 0)).toBe(totalQuadros);

    for (let i = 0; i < 5; i += 1) {
      expect(segmentos[i].inicioMs).toBe(BASE + i * DURACAO_SEGMENTO_PADRAO_MS);
      expect(segmentos[i].fimMs).toBe(BASE + (i + 1) * DURACAO_SEGMENTO_PADRAO_MS);
      expect(segmentos[i].duracaoMs).toBe(DURACAO_SEGMENTO_PADRAO_MS);
      expect(segmentos[i].motivoFim).toBe("duracao");
      expect(segmentos[i + 1].inicioMs).toBe(segmentos[i].fimMs);
    }
    expect(segmentos[5].inicioMs).toBe(BASE + 5 * DURACAO_SEGMENTO_PADRAO_MS);
    expect(segmentos[5].fimMs).toBe(BASE + 179 * 10_000);
    expect(segmentos[5].motivoFim).toBe("sessao_encerrada");
  });
});

describe("GerenciadorGravacao - lacunas", () => {
  it("intervalo sem quadros fecha o segmento como incompleto e nao cobre o buraco", () => {
    const gerenciador = new GerenciadorGravacao({
      duracaoSegmentoMs: 60_000,
      limiarLacunaMs: 2000,
    });
    gerenciador.iniciar({ ambiente: "quintal", agoraMs: BASE });

    gerenciador.quadro(quadro("f0", 0));
    gerenciador.quadro(quadro("f1", 1000));
    const aposLacuna = gerenciador.quadro(quadro("f2", 5000));
    expect(aposLacuna.sequenciaSegmento).toBe(2);
    expect(aposLacuna.offsetMs).toBe(0);

    gerenciador.encerrar(BASE + 6000);
    const [primeiro, segundo] = gerenciador.listarSegmentos();

    expect(primeiro).toMatchObject({
      sequencia: 1,
      inicioMs: BASE,
      fimMs: BASE + 1000,
      duracaoMs: 1000,
      quadros: 2,
      estado: "incompleto",
      motivoFim: "lacuna",
    });
    expect(primeiro.lacunas).toEqual([
      {
        inicioEm: new Date(BASE + 1000).toISOString(),
        inicioMs: BASE + 1000,
        fimEm: new Date(BASE + 5000).toISOString(),
        fimMs: BASE + 5000,
        duracaoMs: 4000,
        motivo: "sem_quadros",
      },
    ]);
    expect(segundo).toMatchObject({
      sequencia: 2,
      inicioMs: BASE + 5000,
      fimMs: BASE + 5000,
      quadros: 1,
      motivoFim: "sessao_encerrada",
    });

    // O trecho sem quadros nao pertence a segmento nenhum.
    expect(gerenciador.segmentoParaTimestamp(BASE + 3000)).toBeUndefined();
    expect(gerenciador.segmentoParaTimestamp(BASE + 1000)?.sequencia).toBe(1);
    expect(gerenciador.segmentoParaTimestamp(BASE + 5000)?.sequencia).toBe(2);
    // Extremos inclusivos: a lacuna toca os dois segmentos que a delimitam.
    expect(sequencias(gerenciador.segmentosParaIntervalo(BASE + 1000, BASE + 5000))).toEqual([
      1, 2,
    ]);
  });

  it("salto que atravessa um segmento inteiro vira lacuna mesmo com limiar alto", () => {
    const gerenciador = new GerenciadorGravacao({
      duracaoSegmentoMs: 1000,
      limiarLacunaMs: 60_000,
    });
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE });
    gerenciador.quadro(quadro("f0", 0));
    const atribuicao = gerenciador.quadro(quadro("f1", 3500));
    gerenciador.encerrar(BASE + 3500);

    expect(atribuicao.sequenciaSegmento).toBe(2);
    const [primeiro, segundo] = gerenciador.listarSegmentos();
    expect(primeiro.estado).toBe("incompleto");
    expect(primeiro.motivoFim).toBe("lacuna");
    expect(primeiro.fimMs).toBe(BASE);
    expect(primeiro.lacunas[0]).toMatchObject({
      inicioMs: BASE,
      fimMs: BASE + 3500,
      motivo: "sem_quadros",
    });
    expect(segundo.inicioMs).toBe(BASE + 3500);
  });
});

describe("GerenciadorGravacao - pausa, encerramento e falha", () => {
  it("pausa fecha no ultimo quadro e retomada abre novo segmento sem lacuna", () => {
    const gerenciador = new GerenciadorGravacao({
      duracaoSegmentoMs: 60_000,
      limiarLacunaMs: 2000,
    });
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE });
    gerenciador.quadro(quadro("f0", 0));
    gerenciador.quadro(quadro("f1", 1000));

    expect(gerenciador.pausar().estado).toBe("pausada");
    expect(motivoRejeicao(() => gerenciador.quadro(quadro("f2", 1200)))).toBe("sessao_pausada");

    expect(gerenciador.retomar().estado).toBe("ativa");
    // O intervalo da pausa e intencional: nao vira lacuna nem e coberto.
    const retomado = gerenciador.quadro(quadro("f3", 9000));
    expect(retomado.sequenciaSegmento).toBe(2);
    expect(retomado.offsetMs).toBe(0);
    gerenciador.encerrar(BASE + 9500);

    const [primeiro, segundo] = gerenciador.listarSegmentos();
    expect(primeiro).toMatchObject({
      fimMs: BASE + 1000,
      motivoFim: "pausa",
      estado: "fechado",
    });
    expect(primeiro.lacunas).toEqual([]);
    expect(segundo).toMatchObject({
      inicioMs: BASE + 9000,
      fimMs: BASE + 9000,
      motivoFim: "sessao_encerrada",
    });
    expect(gerenciador.segmentoParaTimestamp(BASE + 5000)).toBeUndefined();
  });

  it("interrupcao preserva segmentos fechados e registra a falha no segmento em curso", () => {
    const gerenciador = new GerenciadorGravacao({
      duracaoSegmentoMs: 1000,
      limiarLacunaMs: 5000,
    });
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE });
    gerenciador.quadro(quadro("f0", 0));
    gerenciador.quadro(quadro("f1", 1200));

    const sessao = gerenciador.interromper(BASE + 5000);
    expect(sessao.estado).toBe("interrompida");

    const segmentos = gerenciador.listarSegmentos();
    expect(segmentos).toHaveLength(2);
    expect(segmentos[0]).toMatchObject({
      sequencia: 1,
      fimMs: BASE + 1000,
      estado: "fechado",
      motivoFim: "duracao",
    });
    expect(segmentos[1]).toMatchObject({
      sequencia: 2,
      inicioMs: BASE + 1000,
      fimMs: BASE + 1200,
      estado: "incompleto",
      motivoFim: "lacuna",
    });
    expect(segmentos[1].lacunas[0]).toMatchObject({
      inicioMs: BASE + 1200,
      fimMs: BASE + 5000,
      motivo: "falha",
    });
  });

  it("rejeita quadros sem sessao, invalidos, fora de ordem e apos encerramento", () => {
    const semSessao = new GerenciadorGravacao();
    expect(motivoRejeicao(() => semSessao.quadro(quadro("f0", 0)))).toBe("sem_sessao");

    const gerenciador = new GerenciadorGravacao({ duracaoSegmentoMs: 1000 });
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE });
    expect(
      motivoRejeicao(() => gerenciador.quadro({ frameId: "nan", capturadoEmMs: Number.NaN }))
    ).toBe("tempo_invalido");
    expect(motivoRejeicao(() => gerenciador.quadro(quadro("antes", -1)))).toBe("tempo_invalido");
    expect(() => gerenciador.iniciar({ ambiente: "outra", agoraMs: BASE })).toThrow(
      "sessao de monitoramento em andamento"
    );

    gerenciador.quadro(quadro("f0", 100));
    expect(motivoRejeicao(() => gerenciador.quadro(quadro("f1", 50)))).toBe("fora_de_ordem");

    gerenciador.encerrar(BASE + 200);
    expect(motivoRejeicao(() => gerenciador.quadro(quadro("f2", 300)))).toBe("sessao_encerrada");
    expect(gerenciador.obterSessao()?.estado).toBe("encerrada");

    // Depois de encerrada, uma nova sessao comeca sem herdar segmentos.
    gerenciador.iniciar({ ambiente: "sala", agoraMs: BASE + 1000 });
    expect(gerenciador.listarSegmentos()).toEqual([]);
  });
});

describe("BufferCircularQuadros", () => {
  it("retem por tempo de captura, mantendo o limite inclusivo", () => {
    const buffer = new BufferCircularQuadros<number>({ retencaoMs: 5000 });
    for (const ms of [0, 1000, 5000, 10_000]) buffer.adicionar(ms, ms);

    expect(buffer.instantaneo().map((quadro) => quadro.capturadoEmMs)).toEqual([5000, 10_000]);
    expect(buffer.maisAntigoMs).toBe(5000);
    expect(buffer.maisRecenteMs).toBe(10_000);

    buffer.adicionar(10_001, 10_001);
    expect(buffer.instantaneo().map((quadro) => quadro.capturadoEmMs)).toEqual([10_000, 10_001]);
  });

  it("respeita o teto de capacidade descartando o mais antigo", () => {
    const buffer = new BufferCircularQuadros<string>({
      retencaoMs: 60_000,
      capacidadeMaxima: 2,
    });
    buffer.adicionar("a", 0);
    buffer.adicionar("b", 1000);
    buffer.adicionar("c", 2000);

    expect(buffer.instantaneo().map((quadro) => quadro.item)).toEqual(["b", "c"]);
    expect(buffer.tamanho).toBe(2);
  });

  it("rejeita fora de ordem e tempo invalido sem alterar a janela", () => {
    const buffer = new BufferCircularQuadros<number>({ retencaoMs: 5000 });
    buffer.adicionar(1, 1000);

    expect(motivoRejeicao(() => buffer.adicionar(2, 900))).toBe("fora_de_ordem");
    expect(motivoRejeicao(() => buffer.adicionar(3, Number.NaN))).toBe("tempo_invalido");
    expect(buffer.tamanho).toBe(1);
    expect(buffer.instantaneo()[0]).toEqual({ item: 1, capturadoEmMs: 1000 });
  });

  it("devolve copia defensiva da janela e dos itens quando ha clonagem", () => {
    const buffer = new BufferCircularQuadros<{ valor: number }>({
      retencaoMs: 5000,
      clonarItem: (item) => ({ ...item }),
    });
    const original = { valor: 1 };
    buffer.adicionar(original, 0);
    original.valor = 99;

    const primeiro = buffer.instantaneo();
    expect(primeiro[0].item.valor).toBe(1);
    primeiro[0].item.valor = 42;
    primeiro.push({ item: { valor: 7 }, capturadoEmMs: 1 });

    const segundo = buffer.instantaneo();
    expect(segundo).toHaveLength(1);
    expect(segundo[0].item.valor).toBe(1);

    buffer.limpar();
    expect(buffer.tamanho).toBe(0);
    expect(buffer.maisRecenteMs).toBeUndefined();
  });

  it("valida a configuracao do buffer", () => {
    expect(() => new BufferCircularQuadros<number>({ retencaoMs: 0 })).toThrow("retencaoMs");
    expect(
      () => new BufferCircularQuadros<number>({ retencaoMs: 1000, capacidadeMaxima: 0 })
    ).toThrow("capacidadeMaxima");
    expect(
      () => new BufferCircularQuadros<number>({ retencaoMs: 1000, capacidadeMaxima: 1.5 })
    ).toThrow("capacidadeMaxima");
  });
});
