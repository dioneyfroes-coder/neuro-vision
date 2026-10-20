import { ErroPercepcao } from "../src/erros";
import {
  LADO_ENTRADA_YOLO,
  carregarRuntimeYolo,
  decodificarImagem,
  interpretarSaidaYolo,
  liberarSessaoYolo,
  obterSessaoYolo,
  rasterizar,
  rgbaParaTensorNCHW,
} from "./yolo-onnx";
import type { DeteccaoYOLO, MotorDeteccao, OpcoesInferenciaYolo, RuntimeORT, SessaoORT } from "./yolo-onnx";

/**
 * Detector **NSFW experimental** — mesmas pecas do YOLO COCO
 * (`public/yolo-onnx.ts`): runtime `onnxruntime-web` em WASM vindo do CDN sob
 * demanda, sessao compartilhada por URL e pre-pos-processamento stretch
 * 640x640 /255 NCHW.
 *
 * Diferenças do COCO:
 * - os pesos **nao vem de CDN publica**: sao exportados localmente de
 *   `yolonsfw/*.pt` para `yolonsfw/*.onnx` (`scripts/exportar-yolo-nsfw.mjs`)
 *   e servidos pelo proprio servidor em `/yolonsfw/`. A pasta e gitignored —
 *   os pesos nunca sao commitados; sem export, o subsistema falha com mensagem
 *   instruindo como gerar os arquivos.
 * - os rotulos vem do sidecar `<modelo>.onnx.json` gravado junto do export
 *   (nomes de classe do proprio modelo); sem sidecar, os ids aparecem como
 *   `classe N`.
 *
 * O subsistema e desligado por padrao: so carrega quando o usuario habilita o
 * toggle "NSFW (experimental)" da interface.
 */

/** Diretorio servido pelo backend (mesma raiz do `yolonsfw/` gitignored). */
export const DIR_NSFW = "/yolonsfw";

/** Modelo padrao: o nano, rapido o suficiente para 4 frames por ciclo. */
export const MODELO_NSFW_PADRAO = "erax_nsfw_yolo11n";

/** Resolve a chave do catalogo (ou URL direta) para o `model.onnx` servido. */
export function urlModeloNsfw(modelo: string | null | undefined): string {
  const chave = modelo?.trim() || MODELO_NSFW_PADRAO;
  if (chave.startsWith("http") || chave.startsWith("/")) return chave;
  return `${DIR_NSFW}/${chave}.onnx`;
}

/**
 * Carrega os rotulos do sidecar `<url>.onnx.json` gravado pelo export.
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

/**
 * Motor NSFW sobre ONNX (contrato interno `MotorDeteccao`, o mesmo do COCO —
 * a saida e do mesmo formato `[1, 300, 6]`, com NMS embutido no export).
 */
export class DetectorNsfwOnnx implements MotorDeteccao {
  modelo: string | null = null;
  /** Mesma decisao de compatibilidade do COCO: WASM, sem WebGPU. */
  dispositivo = "wasm" as const;
  tempoCargaMs: number | null = null;
  aoStatus?: (mensagem: string) => void;

  private sessao: SessaoORT | null = null;
  private runtime: RuntimeORT | null = null;
  private urlModelo: string | null = null;
  private rotulos: string[] | null = null;

  async carregar(modelo: string | null, aoStatus?: (mensagem: string) => void): Promise<void> {
    if (aoStatus) this.aoStatus = aoStatus;
    const chave = modelo?.trim() || MODELO_NSFW_PADRAO;
    const url = urlModeloNsfw(chave);
    if (this.sessao && this.urlModelo === url) return;
    const inicio = performance.now();
    this.aoStatus?.("carregando");
    // A sessao compartilha runtime/cache com o detector COCO; os pesos locais
    // nao existem ate `scripts/exportar-yolo-nsfw.mjs` rodar (erro claro no 404).
    this.sessao = await obterSessaoYolo(url);
    this.runtime = await carregarRuntimeYolo();
    this.rotulos = await carregarRotulosNsfw(url);
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
    const bitmap = await decodificarImagem(imagem);
    try {
      const larguraOriginal = bitmap.width;
      const alturaOriginal = bitmap.height;
      const rgba = rasterizar(bitmap, LADO_ENTRADA_YOLO);
      const dados = rgbaParaTensorNCHW(rgba);
      const sessao = this.sessao;
      const entrada = sessao.inputNames[0];
      const saida = sessao.outputNames[0];
      const feeds = {
        [entrada]: new this.runtime.Tensor("float32", dados, [
          1,
          3,
          LADO_ENTRADA_YOLO,
          LADO_ENTRADA_YOLO,
        ]),
      };
      const resultado = await sessao.run(feeds);
      const tensor = resultado[saida];
      if (!tensor) throw new ErroPercepcao("detector", "Saida do classificador NSFW vazia.");
      return interpretarSaidaYolo(
        tensor.data,
        tensor.dims,
        limiar,
        larguraOriginal,
        alturaOriginal,
        LADO_ENTRADA_YOLO,
        this.rotulos ?? []
      );
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
  }
}
