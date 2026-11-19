import { describe, expect, it } from "vitest";

import { criarHarness } from "../helpers/gravador-cliente";

describe("ControladorMonitoramento", () => {

  it("interrompe com falha se o gravador novo não começa na rotação", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    h.cfg.falharCriarGravador = true;

    await h.tick();
    // A interrupção entra na fila depois do tick: drena com um comando extra.
    await h.controlador.reenviarPendentes();

    expect(h.erros.some((e) => /MediaRecorder/.test(e.message))).toBe(true);
    expect(h.chamadas).toContain("interromper:sessao-1:falha");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.estados.at(-1)).toBe("encerrada");
    expect(h.gravadores).toHaveLength(1);
  });

  it("falha de upload vai para pendentes e reenviarPendentes reenvia", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"], falharVideo: true });
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.tick();

    expect(h.uploads).toHaveLength(0);
    expect(h.controlador.uploadsPendentes).toBe(1);
    expect(h.erros).toHaveLength(1);

    h.cfg.falharVideo = false;
    expect(await h.controlador.reenviarPendentes()).toBe(1);
    expect(h.controlador.uploadsPendentes).toBe(0);
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(await h.uploads[0].bytes.text()).toBe("bytes-0");
  });

  it("falha do indice nao interrompe a gravacao nem inventa segmento", async () => {
    const h = criarHarness({ falharQuadros: true });
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.tick();

    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.controlador.segmentoAtual).toBeNull();
    expect(h.erros).toHaveLength(2);
    expect(h.uploads).toEqual([]);
  });

  it("erro do MediaRecorder durante o segmento renova o gravador sem encerrar", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    expect(h.controlador.segmentoAtual).toBe("seg-1");

    h.gravadores[0].onerror?.(new Error("MediaRecorder parou"));
    await h.tick();
    await h.tick();

    expect(h.chamadas).toContain("pausar:sessao-1");
    expect(h.chamadas).toContain("retomar:sessao-1");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(2);
    expect(h.controlador.segmentoAtual).toBe("seg-2");
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.erros.some((erro) => /MediaRecorder parou|gravacao/.test(erro.message))).toBe(true);
  });

  it("registra rejeicoes sem descartar o lote", async () => {
    const h = criarHarness({ rejeitarQuadros: true });
    await h.controlador.iniciar("sala");
    await h.tick();
    expect(h.controlador.segmentoAtual).toBe("seg-1");
    expect(h.erros[0].message).toMatch(/recusado/);
  });

});
