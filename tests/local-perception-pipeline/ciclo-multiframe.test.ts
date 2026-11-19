import { describe, expect, it } from "vitest";
import { criarProcessadorFrameLocal } from "../../public/perception/local-perception-pipeline";
import { estaIndisponivel } from "../../src/domain";
import { executarCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import type { DependenciasCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import { SnapshotStore } from "../../public/capture/snapshot-store";
import { CONFIG_CAPTURA_PADRAO, WebcamCapture } from "../../public/capture/webcam-capture";
import {
  DETECCAO,
  DetectorFalso,
  MAOS,
  MaosFalso,
  PoseFalso,
  fonteComImagens,
} from "../helpers/local-perception-pipeline";

describe("pipeline local ligado ao ciclo multiframe", () => {
  it("associa cada observacao ao seu frame e isola falha de um modelo", async () => {
    // Pose quebra em todos os frames; deteccao e maos seguem valendo.
    const processarFrame = criarProcessadorFrameLocal({
      detector: new DetectorFalso(),
      pose: new PoseFalso([], "lanca"),
      maos: new MaosFalso(),
    });

    const store = new SnapshotStore({ maxQuadros: 4 });
    const deps: DependenciasCicloMultiframe = {
      captura: new WebcamCapture(fonteComImagens(["A", "B", "C", "D"]), CONFIG_CAPTURA_PADRAO, {
        agora: () => 0,
        esperar: async () => undefined,
        agoraIso: () => "2026-10-16T10:00:00.000Z",
      }),
      store,
      processarFrame,
      interpretador: {
        modelo: null,
        interpretar: async (pacote) => ({
          resumo: `${pacote.observacoes.length} frames`,
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 1,
        }),
      },
      sessaoId: "sess0001",
      proximoCycleId: () => "sess0001-c1",
      agora: () => 0,
      agoraIso: () => "2026-10-16T10:00:00.000Z",
    };

    const resultado = await executarCicloMultiframe(deps);

    // Uma observacao por frame capturado, com ids e timestamps preservados.
    expect(resultado.pacote.observacoes.map((o) => o.frameId)).toEqual([
      "sess0001-c1-f0",
      "sess0001-c1-f1",
      "sess0001-c1-f2",
      "sess0001-c1-f3",
    ]);
    for (const [i, obs] of resultado.pacote.observacoes.entries()) {
      expect(obs.imagem).toBe(["A", "B", "C", "D"][i]);
      expect(obs.capturadoEm).toBe("2026-10-16T10:00:00.000Z");
      // Falha de pose nao apaga deteccao de objetos nem maos no mesmo frame.
      expect(estaIndisponivel(obs.pose)).toBe(true);
      expect(obs.deteccoes).toEqual(DETECCAO);
      expect(obs.maos).toEqual(MAOS);
    }
    // Falha de subsistema nao derruba o ciclo.
    expect(resultado.cancelado).toBe(false);
  });
});
