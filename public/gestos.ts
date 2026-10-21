import { ErroPercepcao } from "../src/erros";
import type { CriadorMotorMaos, MaoCru } from "./perception/adapters/hand-gesture.adapter";
import type {
  CategoriaVision,
  ReconhecedorVision,
  ResultadoGestos,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
import { caminhosMediaPipe, modelosDisponivel, baseModelosLocal, VERSAO_MEDIAPIPE } from "./offline";

/**
 * Motor de maos/gestos (MediaPipe Gesture Recognizer) — Etapa 5 do roteiro.
 *
 * Modulo **especifico do SDK**: carrega `@mediapipe/tasks-vision` (local do
 * servidor quando o modo offline esta preparado, senao pelo CDN), cria o
 * `GestureRecognizer` e traduz a saida do `recognize` para `SaidaMaosCru`
 * (landmarks normalizados, rotulo cru de lateralidade e categorias de gesto). O
 * adaptador `AdaptadorMaos` faz a normalizacao para o dominio; nenhuma regra de
 * negocio vive aqui.
 *
 * Os testes unitarios usam um motor falso injetado; este modulo so roda num
 * navegador, nunca em CI.
 *
 * **Versao do runtime:** fixada em `public/offline.ts` (`VERSAO_MEDIAPIPE`) e no
 * manifesto de download. Use uma versao que exista no npm — `0.10.22`, por
 * exemplo, **nunca foi publicada** (a linha 0.10.x salta de `0.10.21` para
 * `0.10.22-rc...`), e o CDN devolve 404 para o `import()` dinamico.
 */

/** Caminho padrao do modelo `.task` do Gesture Recognizer (fallback CDN). */
export const MODELO_MAOS_PADRAO =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

/** Caminho do modelo quando servido localmente (`/modelos/maos/`). */
const MODELO_MAOS_LOCAL = "maos/gesture_recognizer.task";

/** Maior numero de maos detectadas por frame (a aplicacao observa gestos). */
const MAX_MAOS = 2;

/**
 * Tempo maximo (ms) para o `GestureRecognizer` iniciar com um delegate. A
 * inicializacao GPU pode travar em ambientes sem WebGL/WebGPU; sem limite, o
 * carregamento ficaria pendurado e o ciclo nunca comecaria.
 */
export const TIMEOUT_CARGA_MAOS_MS = 15_000;

/** Delegates tentados, na ordem: GPU primeiro, CPU como fallback documentado. */
const DELEGATES_MAOS = ["GPU", "CPU"] as const;
type DelegateMaos = (typeof DELEGATES_MAOS)[number];

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

/** Rejeita se `promessa` nao resolver dentro de `timeoutMs`. */
function comTimeout<T>(promessa: Promise<T>, timeoutMs: number, contexto: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${contexto} excedeu ${timeoutMs} ms`)),
      timeoutMs
    );
    promessa.then(
      (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(timer);
        reject(erro);
      }
    );
  });
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

/**
 * Inicia o reconhecedor tentando os delegates em ordem (GPU, depois CPU).
 *
 * Funcao pura de orquestracao: recebe a fabrica (`criar`), que encapsula a
 * chamada real ao SDK, e devolve o reconhecedor junto do delegate efetivo. Assim
 * o fallback e testavel sem carregar o MediaPipe. Propaga o ultimo erro quando
 * todos os delegates falham.
 */
export async function iniciarReconhecedorComFallback(
  criar: (delegate: DelegateMaos) => Promise<ReconhecedorVision>,
  aoStatus?: (mensagem: string) => void,
  timeoutMs: number = TIMEOUT_CARGA_MAOS_MS
): Promise<{ reconhecedor: ReconhecedorVision; delegate: DelegateMaos }> {
  let ultimoErro: unknown = null;
  for (const tentativa of DELEGATES_MAOS) {
    try {
      const reconhecedor = await comTimeout(
        criar(tentativa),
        timeoutMs,
        `inicializacao do Gesture Recognizer em ${tentativa}`
      );
      if (tentativa === "CPU" && ultimoErro) {
        aoStatus?.(`MediaPipe GPU indisponivel (${mensagemDe(ultimoErro)}); usando CPU.`);
      }
      return { reconhecedor, delegate: tentativa };
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw new ErroPercepcao(
    "detector",
    `falha ao iniciar o Gesture Recognizer (GPU e CPU): ${mensagemDe(ultimoErro)}`,
    { cause: ultimoErro }
  );
}

/**
 * Cria o motor de maos/gestos do MediaPipe para o modelo `.task` informado.
 *
 * **Fallback GPU -> CPU (Fase 2, item 3):** tenta iniciar o reconhecedor com
 * `delegate: "GPU"`; se a inicializacao falhar ou estourar o timeout, repete com
 * `delegate: "CPU"` e avisa pelo `aoStatus`. O dispositivo efetivamente usado
 * fica exposto em `dispositivo` para a telemetria do adaptador. Sem WebGL/WebGPU
 * disponivel, o caminho CPU garante que as maos ainda sejam reconhecidas.
 */
export const criarMotorGestosMediaPipe: CriadorMotorMaos = async (modelo, aoStatus) => {
  const usarLocal = await modelosDisponivel();
  const caminhoModelo = modelo
    ? modelo
    : usarLocal
      ? `${baseModelosLocal()}/${MODELO_MAOS_LOCAL}`
      : MODELO_MAOS_PADRAO;
  aoStatus?.("Carregando reconhecedor de maos/gestos (MediaPipe)...");

  const caminhos = await caminhosMediaPipe();
  let modulo: {
    FilesetResolver: { forVisionTasks(caminhoWasm: string): Promise<unknown> };
    GestureRecognizer: {
      createFromOptions(vision: unknown, opcoes: unknown): Promise<ReconhecedorVision>;
    };
  };
  try {
    // `@vite-ignore` mantem o import dinamico no bundle: a URL (local ou CDN) e
    // resolvida em tempo de execucao.
    modulo = await import(/* @vite-ignore */ caminhos.modulo);
  } catch (err) {
    throw new ErroPercepcao("detector", `falha ao carregar MediaPipe: ${mensagemDe(err)}`, {
      cause: err,
    });
  }

  const vision = await modulo.FilesetResolver.forVisionTasks(caminhos.wasm);
  const { reconhecedor: motor, delegate } = await iniciarReconhecedorComFallback(
    (tentativa) =>
      modulo.GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: caminhoModelo, delegate: tentativa },
        runningMode: "IMAGE",
        numHands: MAX_MAOS,
      }),
    aoStatus
  );

  return {
    dispositivo: delegate,
    versao: VERSAO_MEDIAPIPE,
    async executar(imagem) {
      const img = await carregarImagem(imagem);
      const resultado = motor.recognize(img);
      return { maos: extrairMaos(resultado) };
    },
    encerrar() {
      motor.close?.();
    },
  };
};
