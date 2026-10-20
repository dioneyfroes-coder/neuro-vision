import type { ObjetoVisto } from "../src/types";

/**
 * Helpers de rotulo e resumo da deteccao de objetos.
 *
 * Este modulo e independente de SDK: o motor em si e o YOLO em ONNX
 * (`public/yolo-onnx.ts`, com `onnxruntime-web`), e o adaptador
 * (`public/perception/adapters/object-detector.adapter.ts`) combina os dois —
 * o motor devolve `DeteccaoCrua` e aqui viram objetos de log em portugues.
 */

/** Forma crua de uma deteccao: rotulo COCO em ingles, score e caixa em pixels. */
export interface DeteccaoCrua {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
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
export function descreverDeteccoes(deteccoes: DeteccaoCrua[]): ResultadoDeteccao {
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
