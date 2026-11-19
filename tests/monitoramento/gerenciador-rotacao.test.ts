import { describe, expect, it } from "vitest";
import { DURACAO_SEGMENTO_PADRAO_MS } from "../../src/domain";
import { GerenciadorGravacao } from "../../src/monitoramento/gerenciador-gravacao";
import { BASE, quadro, sequencias } from "../helpers/monitoramento";

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
