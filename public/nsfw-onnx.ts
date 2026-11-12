import { ErroPercepcao } from "../src/erros";
import {
  LADO_ENTRADA_YOLO,
  carregarRuntimeYolo,
  decodificarImagem,
  interpretarSaidaYolo,
  dispositivoSessaoYolo,
  liberarSessaoYolo,
  obterSessaoYolo,
  rasterizar,
  rgbaParaTensorNCHW,
} from "./yolo-onnx";
import type { DeteccaoYOLO, MotorDeteccao, OpcoesInferenciaYolo, RuntimeORT, SessaoORT } from "./yolo-onnx";

/**
 * Detector **NSFW experimental** — runtime `onnxruntime-web` em WASM vindo do
 * CDN sob demanda, sessao compartilhada por URL e pre-processamento stretch
 * `/255` NCHW.
 *
 * O catalogo cobre duas familias:
 *
 * - **EraX NSFW YOLO11** (`erax_nsfw_yolo11n/s/m`): 5 classes, exportado com
 *   NMS embutido (`[1, 300, 6]`), lado 640.
 * - **NudeNet v3.4** (`nudenet_320n`, `nudenet_640m`): 18 classes, incluindo
 *   `MALE_GENITALIA_EXPOSED` e `FEMALE_GENITALIA_COVERED`. O 320n devolve a
 *   saida crua YOLOv8 (`[1, 22, N]`); o 640m e exportado com NMS (`[1, 300, 6]`).
 *
 * Cada modelo tem seu proprio Worker (ver `perception/workers/`). Este modulo
 * nao compartilha sessao ONNX entre modelos diferentes: a chave da sessao e a
 * URL final do `.onnx`.
 *
 * Os pesos **nao vem de CDN publica**: ficam em `modelos/yolonsfw/` (gitignored)
 * e sao servidos pelo proprio servidor em `/yolonsfw/`. O 320n vem pronto do
 * NudeNet; o 640m e exportado por `scripts/exportar-yolo-nsfw.mjs`.
 */

/** Diretorio servido pelo backend (mesma raiz do `modelos/yolonsfw/` gitignored). */
export const DIR_NSFW = "/yolonsfw";

/**
 * Modelo padrao: NudeNet 320n.
 *
 * Medido em `bench/RELATORIO_NSFW_MODELOS_20261109.md`: e mais rapido por frame
 * que o EraX nano (143-365 ms contra 473-873 ms) e tem as classes que o EraX
 * nao tem — genitalia masculina exposta, genitalia coberta e nadegas. O EraX
 * continua no catalogo para quem preferir 5 classes e saida NMS.
 */
export const MODELO_NSFW_PADRAO = "nudenet_320n";

/** Classes do NudeNet v3.4 na ordem dos ids do modelo. */
export const CLASSES_NUDENET = [
  "FEMALE_GENITALIA_COVERED",
  "FACE_FEMALE",
  "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED",
  "FEET_EXPOSED",
  "BELLY_COVERED",
  "FEET_COVERED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
  "FACE_MALE",
  "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_COVERED",
  "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED",
] as const;

/** Definicao de um modelo do catalogo NSFW. */
export interface DefinicaoModeloNsfw {
  /** Nome do arquivo `.onnx` em `/yolonsfw/` (sem extensao). */
  arquivo: string;
  /** Lado da entrada quadrada (o pre-processamento e stretch). */
  lado: number;
  /** `nms`: saida `[1, 300, 6]`; `cru`: saida YOLOv8 `[1, 22, N]`. */
  formato: "nms" | "cru";
  /** Classes conhecidas quando o sidecar nao existe. */
  classes?: readonly string[];
}

/** Catalogo de modelos NSFW servidos localmente. */
export const MODELOS_NSFW: Readonly<Record<string, DefinicaoModeloNsfw>> = {
  erax_nsfw_yolo11n: { arquivo: "erax_nsfw_yolo11n", lado: 640, formato: "nms" },
  erax_nsfw_yolo11s: { arquivo: "erax_nsfw_yolo11s", lado: 640, formato: "nms" },
  erax_nsfw_yolo11m: { arquivo: "erax_nsfw_yolo11m", lado: 640, formato: "nms" },
  nudenet_320n: {
    arquivo: "nudenet_320n",
    lado: 320,
    formato: "cru",
    classes: CLASSES_NUDENET,
  },
  nudenet_640m: {
    arquivo: "nudenet_640m",
    lado: 640,
    formato: "nms",
    classes: CLASSES_NUDENET,
  },
  // Detector dedicado de penis (YOLOv8m fine-tuned). Cobre o que os modelos
  // generalistas perdem em close-ups e angulos incomuns. Exportado com NMS
  // embutido (`[1, 300, 6]`), uma unica classe `penis`.
  penis_yolov8m: {
    arquivo: "penis_yolov8m",
    lado: 640,
    formato: "nms",
    classes: ["penis"],
  },
};

/**
 * Id composto que ativa o **conjunto** NSFW na interface.
 *
 * Nao e um arquivo `.onnx`: e o sinal de que todos os modelos de
 * `MODELOS_NSFW_CONJUNTO` devem carregar, cada um no proprio worker/thread, e
 * rodar sobre o mesmo frame. O adaptador `AdaptadorNsfwConjunto` resolve o
 * conjunto; o catalogo continua aceitando um modelo unico para diagnostico.
 */
export const MODELO_NSFW_CONJUNTO = "conjunto_nsfw";

/**
 * Modelos executados automaticamente quando o toggle NSFW e ligado.
 *
 * A ordem prioriza recall e diversidade: NudeNet (classes cobertas e genitalia
 * masculina), EraX (NMS estavel e `make_love`) e o detector dedicado de penis.
 * O resultado de todos e mesclado por rotulo + IoU; nao ha seletor de modelo.
 */
export const MODELOS_NSFW_CONJUNTO = [
  "nudenet_320n",
  "nudenet_640m",
  "erax_nsfw_yolo11n",
  "erax_nsfw_yolo11s",
  "erax_nsfw_yolo11m",
  "penis_yolov8m",
] as const;

/**
 * Limiares por classe. Um unico limiar global esconde justamente o que importa:
 * penis e genital coberto costumam ficar entre 0,15 e 0,35 enquanto `nipple`
 * passa de 0,5. O limiar global continua valendo para classes sem entrada aqui.
 */
export const LIMIARES_NSFW: Readonly<Record<string, number>> = {
  // EraX
  penis: 0.25,
  vagina: 0.25,
  anus: 0.25,
  make_love: 0.35,
  nipple: 0.5,
  // NudeNet
  MALE_GENITALIA_EXPOSED: 0.2,
  FEMALE_GENITALIA_EXPOSED: 0.2,
  FEMALE_GENITALIA_COVERED: 0.15,
  ANUS_EXPOSED: 0.2,
  BUTTOCKS_EXPOSED: 0.2,
  FEMALE_BREAST_EXPOSED: 0.5,
  MALE_BREAST_EXPOSED: 0.5,
  ANUS_COVERED: 0.3,
  BUTTOCKS_COVERED: 0.3,
  FEMALE_BREAST_COVERED: 0.4,
};

/** Menor limiar que ainda pode produzir uma deteccao (piso do catalogo). */
export function limiarMinimoNsfw(global = 0.5): number {
  const valores = Object.values(LIMIARES_NSFW);
  return Math.min(global, ...valores);
}

/** Limiar efetivo de um rotulo: especifico quando existe; senao o global. */
export function limiarEfetivoNsfw(rotulo: string, global = 0.5): number {
  return LIMIARES_NSFW[rotulo] ?? global;
}

/** Resolve a definicao do catalogo; chaves/URLs desconhecidas usam o padrao. */
export function definicaoModeloNsfw(modelo: string | null | undefined): DefinicaoModeloNsfw {
  const chave = modelo?.trim() || MODELO_NSFW_PADRAO;
  if (chave === MODELO_NSFW_CONJUNTO) return MODELOS_NSFW[MODELO_NSFW_PADRAO];
  return MODELOS_NSFW[chave] ?? { arquivo: chave, lado: LADO_ENTRADA_YOLO, formato: "nms" };
}

/** Resolve a chave do catalogo (ou URL direta) para o `model.onnx` servido. */
export function urlModeloNsfw(modelo: string | null | undefined): string {
  const chave = modelo?.trim() || MODELO_NSFW_PADRAO;
  if (chave.startsWith("http") || chave.startsWith("/")) return chave;
  return `${DIR_NSFW}/${definicaoModeloNsfw(chave).arquivo}.onnx`;
}

/**
 * Carrega os rotulos do sidecar `<url>.onnx.json` gravado pelo export/baixador.
 * Devolve `null` quando o sidecar nao existe (rotulos viram `classe N`).
 */
async function carregarRotulosNsfw(urlModelo: string): Promise<string[] | null> {
  try {
    const resposta = await fetch(`${urlModelo}.json`);
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as { classes?: unknown };
    const classes = dados.classes;
    if (Array.isArray(classes)) return classes.map(String);
    if (classes && typeof classes === "object") {
      const mapa = classes as Record<string, unknown>;
      const indices = Object.keys(mapa)
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      if (indices.length > 0) return indices.map((n) => String(mapa[n]));
    }
    return null;
  } catch {
    return null;
  }
}

function iou(a: DeteccaoYOLO, b: DeteccaoYOLO): number {
  const x1 = Math.max(a.box.xmin, b.box.xmin);
  const y1 = Math.max(a.box.ymin, b.box.ymin);
  const x2 = Math.min(a.box.xmax, b.box.xmax);
  const y2 = Math.min(a.box.ymax, b.box.ymax);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.box.xmax - a.box.xmin) * Math.max(0, a.box.ymax - a.box.ymin);
  const areaB = Math.max(0, b.box.xmax - b.box.xmin) * Math.max(0, b.box.ymax - b.box.ymin);
  return inter / (areaA + areaB - inter + 1e-9);
}

/** NMS por rotulo (classes diferentes nao se suprimem). */
export function nmsPorRotulo(
  deteccoes: ReadonlyArray<DeteccaoYOLO>,
  iouLimite = 0.45
): DeteccaoYOLO[] {
  const porRotulo = new Map<string, DeteccaoYOLO[]>();
  for (const d of deteccoes) {
    const lista = porRotulo.get(d.label) ?? [];
    lista.push(d);
    porRotulo.set(d.label, lista);
  }
  const saida: DeteccaoYOLO[] = [];
  for (const lista of porRotulo.values()) {
    const ordenada = [...lista].sort((a, b) => b.score - a.score);
    const mantidas: DeteccaoYOLO[] = [];
    for (const candidata of ordenada) {
      if (mantidas.every((m) => iou(candidata, m) <= iouLimite)) mantidas.push(candidata);
    }
    saida.push(...mantidas);
  }
  return saida.sort((a, b) => b.score - a.score);
}

function sigmoid(valor: number): number {
  return 1 / (1 + Math.exp(-valor));
}

/**
 * Tolerancia para considerar um score "fora de [0,1]".
 *
 * Probabilidades em float32 podem sair levemente negativas (ex.: -6e-8). Sem
 * tolerancia, uma unica linha assim dispara o sigmoid e `sigmoid(0) = 0,5`
 * transforma classes ausentes (`FACE_MALE`, `MALE_BREAST_EXPOSED`) em falsos
 * positivos com score 0,5.
 */
const TOLERANCIA_PROBABILIDADE = 1e-3;

/**
 * Decide se a saida crua traz **logits** (precisa de sigmoid) em vez de
 * probabilidades. A decisao e do tensor inteiro, nao de cada linha: assim um
 * residuo numerico isolado nao muda a escala do resto.
 */
function saidaCruaUsaLogits(
  cru: Float32Array,
  linhas: number,
  indice: (linha: number, coluna: number) => number
): boolean {
  for (let i = 0; i < linhas; i += 1) {
    for (let c = 0; c < 18; c += 1) {
      const valor = cru[indice(i, 4 + c)];
      if (!Number.isFinite(valor)) continue;
      if (valor < -TOLERANCIA_PROBABILIDADE || valor > 1 + TOLERANCIA_PROBABILIDADE) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Interpreta a saida crua do YOLOv8/NudeNet (`[1, 22, N]`): 4 coordenadas
 * `cx,cy,w,h` + 18 scores de classe. Aceita a forma transposta `[1, N, 22]`.
 *
 * Aplica sigmoid quando os scores nao estao em [0,1], filtra pelo limiar
 * efetivo de cada rotulo e aplica NMS por classe. As caixas saem em pixels da
 * imagem original.
 */
export function interpretarSaidaNudeNetCru(
  cru: Float32Array,
  dims: number[],
  limiarGlobal: number,
  larguraOriginal: number,
  alturaOriginal: number,
  lado: number,
  rotulos: readonly string[] = CLASSES_NUDENET,
  limiares: Readonly<Record<string, number>> = LIMIARES_NSFW
): DeteccaoYOLO[] {
  if (dims.length < 2) {
    throw new ErroPercepcao("detector", `Saida inesperada do NudeNet: dims=${dims.join("x")}.`);
  }
  const transposto = dims[1] === 22;
  const colunas = 22;
  const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
  if (!Number.isFinite(linhas) || linhas <= 0) {
    throw new ErroPercepcao("detector", `Saida inesperada do NudeNet: dims=${dims.join("x")}.`);
  }
  const indice = (linha: number, coluna: number) =>
    transposto ? coluna * linhas + linha : linha * colunas + coluna;

  const ex = larguraOriginal / lado;
  const ey = alturaOriginal / lado;
  const candidatas: DeteccaoYOLO[] = [];
  const usaLogits = saidaCruaUsaLogits(cru, linhas, indice);

  for (let i = 0; i < linhas; i += 1) {
    const scores = new Array<number>(18);
    for (let c = 0; c < 18; c += 1) {
      const valor = cru[indice(i, 4 + c)];
      scores[c] = usaLogits ? sigmoid(valor) : valor;
    }
    let melhor = 0;
    let score = scores[0];
    for (let c = 1; c < 18; c += 1) {
      if (scores[c] > score) {
        score = scores[c];
        melhor = c;
      }
    }
    if (!Number.isFinite(score)) continue;
    score = Math.min(1, Math.max(0, score));
    const rotulo = rotulos[melhor] ?? `classe ${melhor}`;
    const limiar = limiares[rotulo] ?? limiarGlobal;
    if (!(score >= limiar)) continue;

    const cx = cru[indice(i, 0)];
    const cy = cru[indice(i, 1)];
    const largura = cru[indice(i, 2)];
    const altura = cru[indice(i, 3)];
    const xmin = Math.max(0, Math.min(larguraOriginal, (cx - largura / 2) * ex));
    const ymin = Math.max(0, Math.min(alturaOriginal, (cy - altura / 2) * ey));
    const xmax = Math.max(0, Math.min(larguraOriginal, (cx + largura / 2) * ex));
    const ymax = Math.max(0, Math.min(alturaOriginal, (cy + altura / 2) * ey));
    if (xmax <= xmin || ymax <= ymin) continue;

    candidatas.push({ label: rotulo, score, box: { xmin, ymin, xmax, ymax } });
  }

  return nmsPorRotulo(candidatas);
}

/** Filtra deteccoes de saida NMS pelo limiar efetivo de cada rotulo. */
export function filtrarDeteccoesNsfw(
  deteccoes: ReadonlyArray<DeteccaoYOLO>,
  limiarGlobal = 0.5,
  limiares: Readonly<Record<string, number>> = LIMIARES_NSFW
): DeteccaoYOLO[] {
  return deteccoes.filter((d) => d.score >= (limiares[d.label] ?? limiarGlobal));
}

/**
 * Classes do NudeNet que **nao** descrevem conteudo adulto: rosto, pes, barriga
 * e axila. Elas saem na saida crua e, sem filtro, inundariam o prompt NSFW com
 * marcacoes irrelevantes (`FACE_FEMALE` em 12/12 frames, por exemplo).
 *
 * Rotulos fora desta lista e do catalogo sao preservados: um modelo customizado
 * sem sidecar continua funcionando.
 */
export const CLASSES_NSFW_IGNORADAS: ReadonlySet<string> = new Set([
  "FACE_FEMALE",
  "FACE_MALE",
  "FEET_EXPOSED",
  "FEET_COVERED",
  "BELLY_COVERED",
  "BELLY_EXPOSED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
]);

/** Remove marcacoes nao sensiveis (rosto, pes, barriga, axila). */
export function filtrarClassesNsfwRelevantes(
  deteccoes: ReadonlyArray<DeteccaoYOLO>
): DeteccaoYOLO[] {
  return deteccoes.filter((d) => !CLASSES_NSFW_IGNORADAS.has(d.label));
}

/**
 * Motor NSFW sobre ONNX (contrato interno `MotorDeteccao`).
 *
 * O formato de saida e detectado pelo tensor (`dims[1] === 22` = cru; senao
 * `[1, 300, 6]` com NMS), nao pela chave do catalogo. Isso permite apontar para
 * um export diferente sem quebrar o decoder.
 */
export class DetectorNsfwOnnx implements MotorDeteccao {
  modelo: string | null = null;
  /** Mesma selecao de EP do COCO: WebGPU quando disponivel, senao WASM. */
  dispositivo: "webgpu" | "wasm" = "wasm";
  tempoCargaMs: number | null = null;
  aoStatus?: (mensagem: string) => void;

  private sessao: SessaoORT | null = null;
  private runtime: RuntimeORT | null = null;
  private urlModelo: string | null = null;
  private rotulos: string[] | null = null;
  private lado = LADO_ENTRADA_YOLO;

  async carregar(modelo: string | null, aoStatus?: (mensagem: string) => void): Promise<void> {
    if (aoStatus) this.aoStatus = aoStatus;
    const chave = modelo?.trim() || MODELO_NSFW_PADRAO;
    const definicao = definicaoModeloNsfw(chave);
    const url = urlModeloNsfw(chave);
    if (this.sessao && this.urlModelo === url) return;
    // Troca de modelo na mesma instancia: solta a referencia da sessao anterior
    // (a sessao so e descartada quando nenhum outro detector usa a URL).
    if (this.urlModelo && this.urlModelo !== url) {
      liberarSessaoYolo(this.urlModelo);
      this.sessao = null;
      this.rotulos = null;
    }
    const inicio = performance.now();
    this.aoStatus?.("carregando");
    // A sessao compartilha runtime/cache com os outros detectores; os pesos
    // locais nao existem ate o download/export rodar (erro claro no 404).
    this.sessao = await obterSessaoYolo(url);
    this.runtime = await carregarRuntimeYolo();
    this.dispositivo = dispositivoSessaoYolo(url);
    this.rotulos = (await carregarRotulosNsfw(url)) ?? [...(definicao.classes ?? [])];
    this.lado = definicao.lado;
    this.urlModelo = url;
    this.modelo = chave;
    this.tempoCargaMs = Math.round(performance.now() - inicio);
    this.aoStatus?.("pronto");
  }

  /** Inferencia sobre um frame (data URL), com caixas em pixels. */
  async executar(imagem: string, opcoes?: OpcoesInferenciaYolo): Promise<DeteccaoYOLO[]> {
    if (!this.sessao || !this.runtime) {
      throw new ErroPercepcao("detector", "Classificador NSFW nao carregado.");
    }
    const limiar = opcoes?.threshold ?? 0.5;
    const lado = this.lado;
    const bitmap = await decodificarImagem(imagem);
    try {
      const larguraOriginal = bitmap.width;
      const alturaOriginal = bitmap.height;
      const rgba = rasterizar(bitmap, lado);
      const dados = rgbaParaTensorNCHW(rgba, lado);
      const sessao = this.sessao;
      const entrada = sessao.inputNames[0];
      const saida = sessao.outputNames[0];
      const feeds = {
        [entrada]: new this.runtime.Tensor("float32", dados, [1, 3, lado, lado]),
      };
      const resultado = await sessao.run(feeds);
      const tensor = resultado[saida];
      if (!tensor) throw new ErroPercepcao("detector", "Saida do classificador NSFW vazia.");
      const rotulos = this.rotulos ?? [];
      const cru = tensor.dims[1] === 22;
      const deteccoes = filtrarClassesNsfwRelevantes(
        cru
          ? interpretarSaidaNudeNetCru(
              tensor.data,
              tensor.dims,
              limiar,
              larguraOriginal,
              alturaOriginal,
              lado,
              rotulos.length > 0 ? rotulos : CLASSES_NUDENET
            )
          : filtrarDeteccoesNsfw(
              interpretarSaidaYolo(
                tensor.data,
                tensor.dims,
                limiarMinimoNsfw(limiar),
                larguraOriginal,
                alturaOriginal,
                lado,
                rotulos
              ),
              limiar
            )
      );
      if (opcoes?.percentage) {
        for (const d of deteccoes) {
          d.box.xmin /= larguraOriginal;
          d.box.ymin /= alturaOriginal;
          d.box.xmax /= larguraOriginal;
          d.box.ymax /= alturaOriginal;
        }
      }
      return deteccoes;
    } finally {
      bitmap.close();
    }
  }

  /**
   * Libera a referencia desta instancia a sessao compartilhada. A sessao so e
   * descartada quando nenhum outro detector usa a mesma URL (ver `yolo-onnx.ts`).
   */
  encerrar(): void {
    if (this.urlModelo) liberarSessaoYolo(this.urlModelo);
    this.sessao = null;
    this.runtime = null;
    this.urlModelo = null;
    this.rotulos = null;
    this.modelo = null;
    this.dispositivo = "wasm";
    this.lado = LADO_ENTRADA_YOLO;
  }
}
