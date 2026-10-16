import type { Detector, Deteccao, ProgressInfo } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
import type { ObjetoVisto } from "../src/types";
import { ErroPercepcao } from "../src/erros";

/**
 * Transformers.js vem do CDN com versao fixa (`3.8.1`) em vez do tag flutuante
 * `@3`, para que o comportamento nao mude sem aviso. O carregamento e **sob
 * demanda**: a biblioteca so e baixada quando um modo de deteccao/eventos for
 * usado. Antes, o import estatico fazia a pagina inteira falhar ao carregar
 * quando o CDN estava inacessivel (rede offline) — hoje os modos de visao seguem
 * funcionando e a deteccao falha com mensagem clara. A URL fica literal no
 * `import()` para o vite/vitest conseguirem aplicar o alias de teste e o
 * esbuild manter o carregamento externo no bundle do cliente.
 */
type TipoPipeline = (
  tarefa: "object-detection",
  modelo: string,
  opcoes?: { device?: "webgpu" | "wasm"; progress_callback?: (info: ProgressInfo) => void }
) => Promise<Detector>;

interface ModuloTransformers {
  pipeline: TipoPipeline;
  env: { allowLocalModels: boolean; useBrowserCache: boolean };
}

let promessaModulo: Promise<ModuloTransformers> | null = null;

function carregarTransformers(): Promise<ModuloTransformers> {
  promessaModulo ??= import(
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"
  ).then((mod) => {
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;
    return mod as ModuloTransformers;
  });
  return promessaModulo;
}

const COCO_PT: Record<string, string> = {
  person: "pessoa",
  bicycle: "bicicleta",
  car: "carro",
  motorcycle: "moto",
  airplane: "aviao",
  bus: "onibus",
  train: "trem",
  truck: "caminhao",
  boat: "barco",
  "traffic light": "semaforo",
  "fire hydrant": "hidrante",
  "stop sign": "placa de pare",
  "parking meter": "parquimetro",
  bench: "banco",
  cat: "gato",
  dog: "cachorro",
  bird: "passaro",
  horse: "cavalo",
  sheep: "ovelha",
  cow: "vaca",
  elephant: "elefante",
  bear: "urso",
  zebra: "zebra",
  giraffe: "girafa",
  backpack: "mochila",
  umbrella: "guarda-chuva",
  handbag: "bolsa",
  tie: "gravata",
  suitcase: "mala",
  frisbee: "frisbee",
  skis: "esquis",
  snowboard: "snowboard",
  "sports ball": "bola",
  kite: "pipa",
  "baseball bat": "bastao",
  "baseball glove": "luva",
  skateboard: "skate",
  surfboard: "prancha",
  "tennis racket": "raquete",
  bottle: "garrafa",
  "wine glass": "taca",
  cup: "copo",
  fork: "garfo",
  knife: "faca",
  spoon: "colher",
  bowl: "tigela",
  banana: "banana",
  apple: "maca",
  sandwich: "sanduiche",
  orange: "laranja",
  broccoli: "brocolis",
  carrot: "cenoura",
  "hot dog": "cachorro-quente",
  pizza: "pizza",
  donut: "rosquinha",
  cake: "bolo",
  chair: "cadeira",
  couch: "sofa",
  "potted plant": "planta",
  bed: "cama",
  "dining table": "mesa",
  toilet: "vaso sanitario",
  tv: "televisao",
  laptop: "notebook",
  mouse: "mouse",
  remote: "controle",
  keyboard: "teclado",
  "cell phone": "celular",
  microwave: "micro-ondas",
  oven: "forno",
  toaster: "torradeira",
  sink: "pia",
  refrigerator: "geladeira",
  book: "livro",
  clock: "relogio",
  vase: "vaso",
  scissors: "tesoura",
  "teddy bear": "urso de pelucia",
  "hair drier": "secador",
  toothbrush: "escova de dentes",
};

/** Traduz o rotulo COCO para portugues, mantendo o original quando desconhecido. */
export function traduzir(label: string): string {
  return COCO_PT[label] ?? label;
}

export interface ResultadoDeteccao {
  objetos: ObjetoVisto[];
  resumo: string;
}

/** Converte as deteccoes cruas em objetos de log e num resumo legivel. */
export function descreverDeteccoes(deteccoes: Deteccao[]): ResultadoDeteccao {
  const objetos: ObjetoVisto[] = deteccoes.map((d) => ({
    nome: traduzir(d.label),
    rotulo: d.label,
    score: Number(d.score.toFixed(3)),
    caixa: d.box,
  }));

  const contagem: Record<string, number> = {};
  for (const o of objetos) contagem[o.nome] = (contagem[o.nome] ?? 0) + 1;
  const resumo = objetos.length
    ? Object.entries(contagem)
        .map(([n, c]) => (c > 1 ? `${c}x ${n}` : n))
        .join(", ")
    : "nada reconhecido";

  return { objetos, resumo };
}

/**
 * Erros que apontam para falha do dispositivo WebGPU (e nao para entrada
 * invalida). So esses justificam recarregar em WASM; um erro de entrada nao
 * pode ser mascarado por um fallback silencioso.
 */
export function pareceFalhaDeDispositivo(err: unknown): boolean {
  const mensagem = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /webgpu|adapter|device lost|device removed|context lost|out of memory|\boom\b/.test(
    mensagem
  );
}

/**
 * Encapsula o detector de objetos do Transformers.js: cache por modelo,
 * fallback de WebGPU para CPU e execucao da inferencia.
 *
 * O fallback acontece em duas situacoes distintas: (1) ao **carregar** o
 * pipeline em WebGPU; (2) numa **inferencia** posterior, quando o dispositivo
 * se perde (contexto reiniciado, memoria esgotada). No segundo caso o detector e
 * recarregado em WASM uma unica vez e a inferencia e repetida.
 */
export class DetectorObjetos {
  private readonly cache = new Map<string, Detector>();
  private atualInterno: Detector | null = null;
  private modeloAtual: string | null = null;
  private dispositivoInterno: "webgpu" | "wasm" | null = null;

  /** Aviso de status (ex.: fallback de dispositivo durante a inferencia). */
  aoStatus?: (mensagem: string) => void;

  get modelo(): string | null {
    return this.modeloAtual;
  }

  /** Dispositivo realmente usado na ultima carga ("webgpu" ou fallback "wasm"). */
  get dispositivo(): "webgpu" | "wasm" | null {
    return this.dispositivoInterno;
  }

  async carregar(modelId: string, aoStatus: (mensagem: string) => void): Promise<Detector> {
    const cacheado = this.cache.get(modelId);
    if (cacheado) {
      this.atualInterno = cacheado;
      this.modeloAtual = modelId;
      return cacheado;
    }

    aoStatus(`Carregando modelo ${modelId}...`);
    const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    if (gpu) {
      try {
        return await this.carregarComDispositivo(modelId, "webgpu", aoStatus);
      } catch (err) {
        aoStatus(`WebGPU indisponivel, usando CPU: ${(err as Error).message}`);
      }
    }
    try {
      return await this.carregarComDispositivo(modelId, "wasm", aoStatus);
    } catch (errFallback) {
      throw new ErroPercepcao("detector", (errFallback as Error).message, { cause: errFallback });
    }
  }

  /** Carrega o pipeline num dispositivo especifico e atualiza o cache. */
  private async carregarComDispositivo(
    modelId: string,
    device: "webgpu" | "wasm",
    aoStatus?: (mensagem: string) => void
  ): Promise<Detector> {
    const onProgress = (p: ProgressInfo): void => {
      if (p.status === "progress" && p.file) {
        const pct = p.progress ? Math.round(p.progress) : 0;
        aoStatus?.(`Baixando ${p.file}... ${pct}%`);
      }
    };
    const { pipeline } = await carregarTransformers();
    const detector = await pipeline("object-detection", modelId, {
      device,
      progress_callback: onProgress,
    });
    this.dispositivoInterno = device;
    this.cache.set(modelId, detector);
    this.atualInterno = detector;
    this.modeloAtual = modelId;
    return detector;
  }

  async executar(
    imagem: string,
    opcoes: { threshold: number; percentage: boolean }
  ): Promise<Deteccao[]> {
    const atual = this.atualInterno;
    const modelo = this.modeloAtual;
    if (!atual || !modelo) {
      throw new ErroPercepcao("detector", "Detector nao carregado");
    }
    try {
      return await atual(imagem, opcoes);
    } catch (err) {
      // Fallback so quando a inferencia falha por causa do dispositivo WebGPU.
      if (this.dispositivoInterno !== "webgpu" || !pareceFalhaDeDispositivo(err)) throw err;
      this.aoStatus?.(
        `WebGPU falhou na inferencia; recarregando na CPU (WASM): ${(err as Error).message}`
      );
      // Descarta o detector quebrado e recarrega uma unica vez em WASM.
      this.cache.delete(modelo);
      this.atualInterno = null;
      const recarregado = await this.carregarComDispositivo(modelo, "wasm", this.aoStatus);
      return await recarregado(imagem, opcoes);
    }
  }
}
