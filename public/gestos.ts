import { ErroPercepcao } from "../src/erros";
import type { CriadorMotorMaos, MaoCru } from "./perception/adapters/hand-gesture.adapter";
import type {
  CategoriaVision,
  ReconhecedorVision,
  ResultadoGestos,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22";

/**
 * Motor de maos/gestos (MediaPipe Gesture Recognizer) — Etapa 5 do roteiro.
 *
 * Modulo **especifico do SDK**: carrega `@mediapipe/tasks-vision` pelo CDN, cria
 * o `GestureRecognizer` e traduz a saida do `recognize` para `SaidaMaosCru`
 * (landmarks normalizados, rotulo cru de lateralidade e categorias de gesto). O
 * adaptador `AdaptadorMaos` faz a normalizacao para o dominio; nenhuma regra de
 * negocio vive aqui.
 *
 * Os testes unitarios usam um motor falso injetado; este modulo so roda num
 * navegador com rede, nunca em CI.
 */

/** Caminho padrao do modelo `.task` do Gesture Recognizer. */
export const MODELO_MAOS_PADRAO =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const URL_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";

/** Maior numero de maos detectadas por frame (a aplicacao observa gestos). */
const MAX_MAOS = 2;

interface ImagemCarregavel {
  src: string;
  decode(): Promise<void>;
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function carregarImagem(imagem: string): Promise<unknown> {
  const img = new Image() as unknown as ImagemCarregavel;
  img.src = imagem;
  return img.decode().then(() => img);
}

/** Converte a saida do `recognize` do MediaPipe em `SaidaMaosCru`. */
function extrairMaos(resultado: ResultadoGestos): MaoCru[] {
  const rotulosLateralidade: CategoriaVision[][] = resultado.handedness ?? [];
  const gestos: CategoriaVision[][] = resultado.gestures ?? [];
  return (resultado.landmarks ?? []).map((landmarks, i) => ({
    landmarks: landmarks.map((landmark) => ({ x: landmark.x, y: landmark.y, z: landmark.z })),
    lateralidade: rotulosLateralidade[i]?.[0]?.categoryName,
    gestos: (gestos[i] ?? []).map((categoria) => ({
      nome: categoria.categoryName,
      confianca: categoria.score,
    })),
  }));
}

/** Cria o motor de maos/gestos do MediaPipe para o modelo `.task` informado. */
export const criarMotorGestosMediaPipe: CriadorMotorMaos = async (modelo, aoStatus) => {
  const caminhoModelo = modelo || MODELO_MAOS_PADRAO;
  aoStatus?.("Carregando reconhecedor de maos/gestos (MediaPipe)...");

  let modulo: {
    FilesetResolver: { forVisionTasks(caminhoWasm: string): Promise<unknown> };
    GestureRecognizer: {
      createFromOptions(vision: unknown, opcoes: unknown): Promise<ReconhecedorVision>;
    };
  };
  try {
    modulo = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22"
    );
  } catch (err) {
    throw new ErroPercepcao("detector", `falha ao carregar MediaPipe: ${mensagemDe(err)}`, {
      cause: err,
    });
  }

  try {
    const vision = await modulo.FilesetResolver.forVisionTasks(URL_WASM);
    const reconhecedor = await modulo.GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: caminhoModelo, delegate: "GPU" },
      runningMode: "IMAGE",
      numHands: MAX_MAOS,
    });

    return {
      async executar(imagem) {
        const img = await carregarImagem(imagem);
        const resultado = reconhecedor.recognize(img);
        return { maos: extrairMaos(resultado) };
      },
    };
  } catch (err) {
    throw new ErroPercepcao(
      "detector",
      `falha ao iniciar o Gesture Recognizer: ${mensagemDe(err)}`,
      { cause: err }
    );
  }
};
