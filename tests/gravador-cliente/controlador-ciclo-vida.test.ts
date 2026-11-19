import { describe, expect, it } from "vitest";

import { BASE, criarHarness } from "../helpers/gravador-cliente";

describe("ControladorMonitoramento", () => {

  it("pausa fecha o segmento, retoma abre outro e encerra nao reinicia", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();

    await h.controlador.pausar();
    expect(h.cancelado()).toBe(true);
    expect(h.estados.at(-1)).toBe("pausada");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(1);

    await h.controlador.retomar();
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.gravadores).toHaveLength(2);
    expect(h.cancelado()).toBe(false);

    h.adiantar(5000);
    await h.controlador.encerrar();
    expect(h.chamadas).toContain(`encerrar:sessao-1:${BASE + 5000}`);
    expect(h.estados.at(-1)).toBe("encerrada");
    expect(h.controlador.sessaoAtual).toBeNull();
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    // Nenhum segmento foi atribuido apos retomar (sem tick), entao nada novo.
    expect(h.gravadores).toHaveLength(2);
  });

  it("grava durante queda da camera e indisponibilidade da analise", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    expect(h.controlador.segmentoAtual).toBe("seg-1");

    // Workers/IA indisponíveis e camera sem sinal ao mesmo tempo.
    h.cfg.falharQuadros = true;
    h.controlador.suspenderCaptura("trilha_encerrada");
    h.adiantar(5_000);
    await h.tick();

    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.controlador.semSinal).toBe(true);
    expect(h.quadros).toHaveLength(1);
    expect(h.uploads).toEqual([]);

    // Analise e camera voltam: o proximo quadro rotaciona para um novo segmento.
    h.cfg.falharQuadros = false;
    await h.controlador.retomarCaptura();

    expect(h.controlador.semSinal).toBe(false);
    expect(h.quadros.at(-1)?.[0].capturadoEmMs).toBe(BASE + 5_000);
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(2);
    expect(h.estados.at(-1)).toBe("gravando");
  });

  it("renova o gravador no retorno por reconexao antes de relatar quadros", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();

    h.controlador.suspenderCaptura("trilha_encerrada");
    h.adiantar(5_000);
    await h.controlador.renovarGravador();

    expect(h.chamadas).toContain("pausar:sessao-1");
    expect(h.chamadas).toContain("retomar:sessao-1");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(2);
    expect(h.controlador.segmentoAtual).toBeNull();

    await h.controlador.retomarCaptura();
    expect(h.controlador.segmentoAtual).toBe("seg-2");
    expect(h.gravadores).toHaveLength(2);
    expect(h.estados.at(-1)).toBe("gravando");
  });

  it("interromper por falha encerra sem gerar novo gravador", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.controlador.interromper("falha");

    expect(h.chamadas).toContain("interromper:sessao-1:falha");
    expect(h.estados.at(-1)).toBe("encerrada");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(1);
  });

  it("recusa iniciar uma segunda sessao ativa", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    await expect(h.controlador.iniciar("garagem")).rejects.toThrow(/ativa/);
    expect(h.chamadas).toHaveLength(1);
  });

  it("limpa o gravador e interrompe a sessao se iniciar falhar depois de abri-la", async () => {
    const h = criarHarness({ falharCriarGravador: true });
    await expect(h.controlador.iniciar("sala")).rejects.toThrow(/MediaRecorder/);

    expect(h.chamadas).toEqual([`iniciar:sala:${BASE}`, "interromper:sessao-1:falha"]);
    expect(h.estados.at(-1)).toBe("erro");
    expect(h.controlador.sessaoAtual).toBeNull();
    expect(h.controlador.segmentoAtual).toBeNull();
    // Nenhum tick foi agendado: a falha ocorreu antes de `agendarTick`.
    expect(h.cancelado()).toBe(false);
    expect(h.erros.some((e) => /MediaRecorder/.test(e.message))).toBe(true);
  });

});
