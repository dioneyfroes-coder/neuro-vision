import { LADO_ENTRADA_YOLO } from "../yolo-onnx";

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

/**
 * Limiares por **modelo e classe**.
 *
 * A tabela comeca vazia de proposito: nao existe calibration anotada que
 * justifique numeros por modelo. A infraestrutura aceita overrides injetados
 * (`resolverLimiarNsfw`) e o detector ja informa seu modelo ao resolver, entao
 * uma futura calibracao so precisa preencher esta tabela — sem mudar protocolo.
 */
export const LIMIARES_NSFW_POR_MODELO: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = {};

/** Menor limiar que ainda pode produzir uma deteccao (piso do catalogo). */
export function limiarMinimoNsfw(global = 0.5): number {
  const valores = Object.values(LIMIARES_NSFW);
  return Math.min(global, ...valores);
}

/** Limiar efetivo de um rotulo: especifico quando existe; senao o global. */
export function limiarEfetivoNsfw(rotulo: string, global = 0.5): number {
  return LIMIARES_NSFW[rotulo] ?? global;
}

export interface OpcoesLimiarNsfw {
  /** Limiar global do frame/pedido; default `0,5`. */
  global?: number;
  /** Tabela por classe; default `LIMIARES_NSFW`. */
  limiares?: Readonly<Record<string, number>>;
  /** Modelo que produziu a deteccao; habilita o override por modelo/classe. */
  modelo?: string | null;
  /** Tabela por modelo/classe; default `LIMIARES_NSFW_POR_MODELO`. */
  limiaresPorModelo?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

function limiarValido(valor: number | undefined): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor <= 1;
}

/**
 * Precedencia: override por modelo/classe > tabela por classe > global.
 * Valores invalidos sao ignorados (nunca viram `0` silenciosamente).
 */
export function resolverLimiarNsfw(rotulo: string, opcoes: OpcoesLimiarNsfw = {}): number {
  const global = limiarValido(opcoes.global) ? opcoes.global : 0.5;
  const modelo = opcoes.modelo?.trim();
  const porModelo =
    modelo !== undefined && modelo !== ""
      ? (opcoes.limiaresPorModelo ?? LIMIARES_NSFW_POR_MODELO)[modelo]?.[rotulo]
      : undefined;
  if (limiarValido(porModelo)) return porModelo;
  const porClasse = (opcoes.limiares ?? LIMIARES_NSFW)[rotulo];
  return limiarValido(porClasse) ? porClasse : global;
}

/** Fecha o modelo em um resolvedor de rotulo, para uso na interpretacao. */
export function criarResolutorLimiarNsfw(
  modelo: string | null | undefined,
  opcoes: Omit<OpcoesLimiarNsfw, "modelo"> = {}
): (rotulo: string) => number {
  return (rotulo) => resolverLimiarNsfw(rotulo, { ...opcoes, modelo });
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
