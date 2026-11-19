import type { Caixa } from "../types";

/** Marcacao NSFW pronta para prompt/UI (caixa normalizada em [0, 1]). */
export interface MarcacaoNsfwVisivel {
  rotulo: string;
  score: number;
  caixa: Caixa;
  /** Modelo de maior score que produziu a marcacao, quando conhecido. */
  modelo?: string;
  /** Modelos que concordaram com a mesma regiao/rotulo (evidencia somada). */
  modelos?: string[];
}

/** Marcacoes de uma imagem especifica no prompt multimodal. */
export interface QuadroNsfwPrompt {
  /** Indice 1-based da imagem correspondente, na ordem enviada ao modelo. */
  indice: number;
  /** Id real do frame, quando disponivel. */
  frameId?: string;
  marcacoes: ReadonlyArray<MarcacaoNsfwVisivel>;
}
