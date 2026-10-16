import { describe, expect, it } from "vitest";
import { SnapshotStore } from "../public/capture/snapshot-store";
import type { SnapshotCapturado } from "../public/capture/snapshot-store";
import { CONFIG_CAPTURA_PADRAO, WebcamCapture } from "../public/capture/webcam-capture";
import type { FonteCaptura } from "../public/capture/webcam-capture";
import { ehCancelamento } from "../src/erros";

function snapshot(frameId: string, imagem = `img-${frameId}`): SnapshotCapturado {
  return {
    frameId,
    imagem,
    thumb: `thumb-${frameId}`,
    capturadoEm: "2026-10-16T10:00:00.000Z",
    capturadoEmMs: 0,
  };
}

describe("SnapshotStore", () => {
  it("congela o snapshot ao adicionar", () => {
    const store = new SnapshotStore();
    const guardado = store.adicionar(snapshot("f0"));
    expect(Object.isFrozen(guardado)).toBe(true);
    expect(store.tamanho).toBe(1);
  });

  it("descarta os mais antigos ao exceder o limite de retencao", () => {
    const store = new SnapshotStore({ maxQuadros: 2 });
    store.adicionar(snapshot("f0"));
    store.adicionar(snapshot("f1"));
    store.adicionar(snapshot("f2"));
    expect(store.quadros.map((s) => s.frameId)).toEqual(["f1", "f2"]);
  });

  it("limpar esvazia o buffer", () => {
    const store = new SnapshotStore();
    store.adicionar(snapshot("f0"));
    store.limpar();
    expect(store.tamanho).toBe(0);
    expect(store.quadros).toEqual([]);
  });
});

/** Fonte de captura falsa: devolve imagens distintas por chamada. */
function fonteFalsa(): FonteCaptura {
  let n = 0;
  return {
    ativa: true,
    largura: 1280,
    altura: 720,
    capturarQuadro: () => {
      n += 1;
      return { imagem: `data:image/jpeg;base64,F${n}`, thumb: `data:image/jpeg;base64,T${n}` };
    },
    assinaturaDeCena: () => [1, 2, 3],
  };
}

describe("WebcamCapture", () => {
  it("captura quadros identificados com intervalos regulares, sem inferencia", async () => {
    let t = 0;
    const esperas: number[] = [];
    const captura = new WebcamCapture(fonteFalsa(), CONFIG_CAPTURA_PADRAO, {
      agora: () => t,
      esperar: async (ms) => {
        esperas.push(ms);
        t += ms;
      },
      agoraIso: () => "2026-10-16T10:00:00.000Z",
    });

    const snapshots = await captura.capturar("sess-c1");

    expect(snapshots).toHaveLength(4);
    expect(snapshots.map((s) => s.frameId)).toEqual([
      "sess-c1-f0",
      "sess-c1-f1",
      "sess-c1-f2",
      "sess-c1-f3",
    ]);
    expect(snapshots.map((s) => s.capturadoEmMs)).toEqual([0, 1000, 2000, 3000]);
    expect(snapshots.map((s) => s.imagem)).toEqual([
      "data:image/jpeg;base64,F1",
      "data:image/jpeg;base64,F2",
      "data:image/jpeg;base64,F3",
      "data:image/jpeg;base64,F4",
    ]);
    expect(snapshots[0].dimensoes).toEqual({ largura: 1280, altura: 720 });
    // Tres esperas entre quatro frames.
    expect(esperas).toEqual([1000, 1000, 1000]);
  });

  it("para quando a camera ainda nao tem frame", async () => {
    const semFrame: FonteCaptura = {
      ativa: true,
      largura: 0,
      altura: 0,
      capturarQuadro: () => null,
      assinaturaDeCena: () => null,
    };
    const captura = new WebcamCapture(semFrame);
    expect(await captura.capturar("sess-c1")).toEqual([]);
  });

  it("cancela de forma cooperativa quando o sinal e abortado", async () => {
    const controller = new AbortController();
    controller.abort();
    const captura = new WebcamCapture(fonteFalsa(), CONFIG_CAPTURA_PADRAO, {
      esperar: async () => undefined,
    });
    await expect(captura.capturar("sess-c1", controller.signal)).rejects.toSatisfy(
      ehCancelamento
    );
  });

  it("cancela durante a espera entre frames", async () => {
    const controller = new AbortController();
    const captura = new WebcamCapture(fonteFalsa(), CONFIG_CAPTURA_PADRAO, {
      agora: () => 0,
      esperar: async () => {
        controller.abort();
      },
    });
    await expect(captura.capturar("sess-c1", controller.signal)).rejects.toSatisfy(
      ehCancelamento
    );
  });
});

describe("config de captura", () => {
  it("limita resolucao e qualidade por padrao", () => {
    expect(CONFIG_CAPTURA_PADRAO.quadros).toBe(4);
    expect(CONFIG_CAPTURA_PADRAO.maxLargura).toBeGreaterThan(0);
    expect(CONFIG_CAPTURA_PADRAO.qualidadeJpeg).toBeLessThan(1);
  });
});
