import type { createServer } from "node:http";
import { env } from "../../../src/env";
import type { MarcacaoNsfwLog } from "../../../src/types";

export type ServidorClipe = ReturnType<typeof createServer>;

export const CLIP = env.E2E_WEBCAM_CLIP || undefined;
export const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;
export const DEBUG = env.E2E_WEBCAM_DEBUG;
export const MODO = env.E2E_WEBCAM_MODE;
export const MODELO_VISAO = env.E2E_WEBCAM_MODEL || undefined;
export const NSFW_ATIVO = env.E2E_WEBCAM_NSFW;
export const LIMIAR = env.E2E_WEBCAM_THRESHOLD;
export const VARIANTE_BASELINE = MODO === "eventos";

export type PayloadAnalise = {
  resumo?: string;
  timestamp?: string;
  capturadoEm?: string;
  modelo?: string;
  tipo?: string;
  ms?: number;
  sessaoId?: string;
  frameId?: string;
  nsfw?: MarcacaoNsfwLog[];
};
