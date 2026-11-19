import { describe, expect, it } from "vitest";
import { GerenciadorGravacao } from "../../src/monitoramento/gerenciador-gravacao";
import { BASE, quadro, sequencias } from "../helpers/monitoramento";

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
