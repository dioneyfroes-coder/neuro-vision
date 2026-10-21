/**
 * Tipos minimos do pacote `@mediapipe/tasks-vision` carregado via CDN.
 *
 * Cobre apenas o subconjunto usado pelo reconhecedor de maos/gestos
 * (`public/gestos.ts`): criacao do `GestureRecognizer` e a saida de `recognize`.
 * O esbuild mantem a URL externa no bundle do cliente; nenhum teste carrega o
 * pacote de verdade (os adaptadores usam motores falsos injetados).
 *
 * A versao precisa casar com `VERSAO_MEDIAPIPE` em `public/gestos.ts`.
 */
declare module "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21" {
  export interface CategoriaVision {
    categoryName: string;
    score: number;
  }

  export interface LandmarkVision {
    x: number;
    y: number;
    z: number;
  }

  export interface ResultadoGestos {
    gestures: CategoriaVision[][];
    handedness: CategoriaVision[][];
    landmarks: LandmarkVision[][];
  }

  export interface ReconhecedorVision {
    recognize(imagem: unknown): ResultadoGestos;
    /** Libera os recursos nativos do reconhecedor (GPU/WASM). */
    close?(): void;
  }

  export const FilesetResolver: {
    forVisionTasks(caminhoWasm: string): Promise<unknown>;
  };

  export const GestureRecognizer: {
    createFromOptions(vision: unknown, opcoes: unknown): Promise<ReconhecedorVision>;
  };
}
