import { describe, expect, it } from "vitest";

import { BASE, criarHarness } from "../helpers/gravador-cliente";

describe("ControladorMonitoramento", () => {

  it("reporta so metadados no tick e associa o primeiro gravador ao segmento", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.chamadas).toEqual([`iniciar:sala:${BASE}`]);
    expect(h.gravadores).toHaveLength(1);

    await h.tick();
    expect(h.quadros).toEqual([[{ frameId: "sessao-1-f0", capturadoEmMs: BASE }]]);
    expect(h.controlador.segmentoAtual).toBe("seg-1");
    expect(h.uploads).toHaveLength(0);
    expect(h.chamadas).not.toContain("video:seg-1");
  });

  it("rotaciona: fecha o gravador antigo, envia com o id antigo e abre o novo", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    h.adiantar(10_000);
    await h.tick();

    expect(h.controlador.segmentoAtual).toBe("seg-2");
    expect(h.gravadores).toHaveLength(2);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({ segmentoId: "seg-1", criadoEmMs: BASE + 10_000 });
    expect(await h.uploads[0].bytes.text()).toBe("bytes-0");
    expect(h.chamadas).toContain("video:seg-1");
    expect(h.chamadas).not.toContain("video:seg-2");

    // O gravador novo ja esta ativo antes do antigo ser fechado (sem lacuna).
    expect(h.gravadores[1].state).toBe("recording");
    expect(h.gravadores[0].state).toBe("inactive");
  });

  it("notifica a UI sobre cada segmento novo e sobre o fechamento", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    expect(h.segmentosNotificados).toEqual([]);

    await h.tick();
    expect(h.segmentosNotificados).toEqual(["seg-1"]);
    await h.tick();
    expect(h.segmentosNotificados).toEqual(["seg-1", "seg-2"]);
    await h.tick();
    // Mesmo segmento: nenhuma notificação redundante.
    expect(h.segmentosNotificados).toEqual(["seg-1", "seg-2"]);

    await h.controlador.pausar();
    expect(h.segmentosNotificados).toEqual(["seg-1", "seg-2", null]);
  });

  it("nao reenvia o mesmo segmento em ticks repetidos", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.uploads).toHaveLength(0);
    expect(h.quadros.map((lote) => lote[0].frameId)).toEqual([
      "sessao-1-f0",
      "sessao-1-f1",
      "sessao-1-f2",
    ]);
  });

  it("sobrevive a sessao prolongada com rotacoes e uploads sucessivos", async () => {
    const segmentos = Array.from({ length: 30 }, (_, i) => `seg-${i + 1}`);
    const h = criarHarness({ segmentos });
    await h.controlador.iniciar("sala");

    for (let minuto = 0; minuto < 30; minuto += 1) {
      h.adiantar(60_000);
      await h.tick();
    }

    expect(h.quadros).toHaveLength(30);
    expect(h.gravadores).toHaveLength(30);
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(segmentos.slice(0, 29));
    expect(h.controlador.uploadsPendentes).toBe(0);
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.controlador.segmentoAtual).toBe("seg-30");
  });

});
