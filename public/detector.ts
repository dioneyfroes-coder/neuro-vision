import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
import type { Detector, Deteccao, ProgressInfo } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
import type { ObjetoVisto } from "../src/types";

env.allowLocalModels = false;
env.useBrowserCache = true;

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
 * Encapsula o detector de objetos do Transformers.js: cache por modelo,
 * fallback de WebGPU para CPU e execucao da inferencia.
 */
export class DetectorObjetos {
  private readonly cache = new Map<string, Detector>();
  private atualInterno: Detector | null = null;
  private modeloAtual: string | null = null;

  get modelo(): string | null {
    return this.modeloAtual;
  }

  async carregar(modelId: string, aoStatus: (mensagem: string) => void): Promise<Detector> {
    const cacheado = this.cache.get(modelId);
    if (cacheado) {
      this.atualInterno = cacheado;
      this.modeloAtual = modelId;
      return cacheado;
    }

    const onProgress = (p: ProgressInfo): void => {
      if (p.status === "progress" && p.file) {
        const pct = p.progress ? Math.round(p.progress) : 0;
        aoStatus(`Baixando ${p.file}... ${pct}%`);
      }
    };

    aoStatus(`Carregando modelo ${modelId}...`);
    const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    const device = gpu ? "webgpu" : "wasm";
    let novo: Detector;
    try {
      novo = await pipeline("object-detection", modelId, { device, progress_callback: onProgress });
    } catch (err) {
      aoStatus(`WebGPU indisponivel, usando CPU: ${(err as Error).message}`);
      novo = await pipeline("object-detection", modelId, {
        device: "wasm",
        progress_callback: onProgress,
      });
    }
    this.cache.set(modelId, novo);
    this.atualInterno = novo;
    this.modeloAtual = modelId;
    return novo;
  }

  async executar(imagem: string, opcoes: { threshold: number; percentage: false }): Promise<Deteccao[]> {
    if (!this.atualInterno) throw new Error("Detector nao carregado");
    return this.atualInterno(imagem, opcoes);
  }
}
