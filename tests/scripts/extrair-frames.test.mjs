import { describe, expect, it } from "vitest";

import { tipoMimeVideo } from "../../scripts/extrair-frames.mjs";

describe("tipoMimeVideo", () => {
  it("seleciona MIME correto para MP4 e WebM", () => {
    expect(tipoMimeVideo("amostra.MP4")).toBe("video/mp4");
    expect(tipoMimeVideo("amostra.webm")).toBe("video/webm");
  });

  it("rejeita formatos nao suportados", () => {
    expect(() => tipoMimeVideo("amostra.avi")).toThrow("formato de video nao suportado");
  });
});
