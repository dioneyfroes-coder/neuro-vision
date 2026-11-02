import { afterEach, describe, expect, it } from "vitest";
import { env } from "../src/env";

const limiarAnterior = process.env.E2E_WEBCAM_THRESHOLD;
const timeoutAnterior = process.env.NEURO_VISION_TIMEOUT_MS;

afterEach(() => {
  if (limiarAnterior === undefined) delete process.env.E2E_WEBCAM_THRESHOLD;
  else process.env.E2E_WEBCAM_THRESHOLD = limiarAnterior;
  if (timeoutAnterior === undefined) delete process.env.NEURO_VISION_TIMEOUT_MS;
  else process.env.NEURO_VISION_TIMEOUT_MS = timeoutAnterior;
});

describe("env.E2E_WEBCAM_THRESHOLD", () => {
  it("usa 0.5 quando nao configurado", () => {
    delete process.env.E2E_WEBCAM_THRESHOLD;
    expect(env.E2E_WEBCAM_THRESHOLD).toBe(0.5);
  });

  it("preserva valores invalidos para que o teste E2E os rejeite", () => {
    process.env.E2E_WEBCAM_THRESHOLD = "nao-numero";
    expect(env.E2E_WEBCAM_THRESHOLD).toBeNaN();
  });

  it("permite ate cinco minutos para inferencia multimodal local", () => {
    delete process.env.NEURO_VISION_TIMEOUT_MS;
    expect(env.NEURO_VISION_TIMEOUT_MS).toBe(300_000);
  });
});
