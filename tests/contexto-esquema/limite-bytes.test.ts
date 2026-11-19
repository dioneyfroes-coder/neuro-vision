import { describe, expect, it } from "vitest";
import {
  montarContextoCiclo,
  tamanhoBytesUtf8,
} from "../../public/interpretation/contexto";
import {
  observacao,
  pacote,
} from "../helpers/contexto-esquema";

describe("limite de contexto em bytes UTF-8 (P2.3)", () => {
  it("mede bytes UTF-8, nao unidades de string", () => {
    const valor = { texto: "ação 🙌" };
    const texto = JSON.stringify(valor);
    expect(tamanhoBytesUtf8(valor)).toBe(new TextEncoder().encode(texto).length);
    // Acentos e emoji ocupam mais bytes do que unidades de string.
    expect(tamanhoBytesUtf8(valor)).toBeGreaterThan(texto.length);
  });

  it("nao registra limite quando o contexto cabe", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]));
    expect(contexto.limiteContexto).toBeUndefined();
    expect(tamanhoBytesUtf8(contexto)).toBeLessThanOrEqual(16_000);
  });

  it("registra explicitamente quando o contexto nao cabe apos as reducoes", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]), {
      maxBytesContexto: 60,
    });
    expect(contexto.limiteContexto?.excedeu).toBe(true);
    expect(contexto.limiteContexto?.maxBytes).toBe(60);
    // `bytes` e medido antes do proprio registro de limite.
    expect(contexto.limiteContexto!.bytes).toBeGreaterThan(60);
  });

  it("ao reduzir landmarks completos, deixa de afirmar landmarksCompletos", () => {
    const obs = Array.from({ length: 4 }, (_, i) =>
      observacao({ frameId: `f${i}`, capturadoEmMs: i * 100 })
    );
    const { contexto } = montarContextoCiclo(pacote(obs), { maxBytesContexto: 800 }, {
      serializacao: { landmarksCompletos: true },
    });
    for (const frame of contexto.frames) {
      for (const mao of frame.maos) {
        expect(mao.landmarks.length).toBeLessThanOrEqual(6);
        expect(mao.landmarksCompletos).toBe(false);
      }
    }
  });
});