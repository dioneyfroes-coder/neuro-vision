import { describe, expect, it } from "vitest";
import { GerenciadorGravacao } from "../../src/monitoramento/gerenciador-gravacao";
import { BASE, motivoRejeicao, quadro } from "../helpers/monitoramento";

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
