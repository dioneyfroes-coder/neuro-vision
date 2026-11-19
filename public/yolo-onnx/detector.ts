import { ErroPercepcao } from "../../src/erros";
import { baseModelosLocal, modelosDisponivel } from "../offline";
import {
  LADO_ENTRADA_YOLO,
  MODELOS_COCO_LOCAIS,
  MODELOS_COCO_YOLO,
  MODELO_YOLO_PADRAO,
  type DeteccaoYOLO,
  type MotorDeteccao,
  type OpcoesInferenciaYolo,
  type RuntimeORT,
  type SessaoORT,
  type TensorORT,
} from "./tipos";
import {
  carregarRuntimeYolo,
  dispositivoSessaoYolo,
  liberarSessaoYolo,
  obterSessaoYolo,
} from "./sessao";
import {
  decodificarImagem,
  interpretarSaidaYolo,
  rasterizar,
  rgbaParaTensorNCHW,
} from "./imagem";

/** Detector COCO via YOLO ONNX (mesmo contrato interno do antigo detector). */
export class DetectorYoloOnnx implements MotorDeteccao {
  modelo: string | null = null;
  /** EP efetivo da sessao: WebGPU quando disponivel, senao WASM. */
  dispositivo: "webgpu" | "wasm" = "wasm";
  tempoCargaMs: number | null = null;
  aoStatus?: (mensagem: string) => void;

  private sessao: SessaoORT | null = null;
  private runtime: RuntimeORT | null = null;
  private urlModelo: string | null = null;

  /** Resolve a chave do catalogo (ou uma URL direta) para o `model.onnx`. */
  static resolverUrl(modelo: string | null | undefined): string {
    const chave = modelo?.trim() || MODELO_YOLO_PADRAO;
    const catalogo = MODELOS_COCO_YOLO[chave];
    if (catalogo) return catalogo.url;
    if (chave.startsWith("http")) return chave;
    return MODELOS_COCO_YOLO[MODELO_YOLO_PADRAO].url;
  }

  /**
   * Como `resolverUrl`, mas prefere o caminho local (`/modelos/coco/...`) quando
   * o modo offline esta preparado. URLs diretas informadas pelo usuario nao sao
   * trocadas.
   */
  static async resolverUrlOffline(modelo: string | null | undefined): Promise<string> {
    const chave = modelo?.trim() || MODELO_YOLO_PADRAO;
    if (chave.startsWith("http")) return chave;
    if (await modelosDisponivel()) {
      const local = MODELOS_COCO_LOCAIS[chave] ?? MODELOS_COCO_LOCAIS[MODELO_YOLO_PADRAO];
      return `${baseModelosLocal()}/${local}`;
    }
    return DetectorYoloOnnx.resolverUrl(chave);
  }

  async carregar(modelo: string | null, aoStatus?: (mensagem: string) => void): Promise<void> {
    if (aoStatus) this.aoStatus = aoStatus;
    const chave = modelo?.trim() || null;
    const url = await DetectorYoloOnnx.resolverUrlOffline(chave);
    if (this.sessao && this.urlModelo === url) return;
    const inicio = performance.now();
    this.aoStatus?.("carregando");
    this.sessao = await obterSessaoYolo(url);
    this.runtime = await carregarRuntimeYolo();
    this.dispositivo = dispositivoSessaoYolo(url);
    this.urlModelo = url;
    this.modelo =
      chave && (chave in MODELOS_COCO_YOLO || chave.startsWith("http"))
        ? chave
        : MODELO_YOLO_PADRAO;
    this.tempoCargaMs = Math.round(performance.now() - inicio);
    this.aoStatus?.("pronto");
  }

  /** Inferencia sobre um frame (data URL), com caixas em pixels. */
  async executar(
    imagem: string,
    opcoes?: OpcoesInferenciaYolo
  ): Promise<DeteccaoYOLO[]> {
    if (!this.sessao || !this.runtime) {
      throw new ErroPercepcao("detector", "Detector YOLO nao carregado.");
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
      // Os feeds exigem instancias de `ort.Tensor` (validado em
      // `scripts/verificar-yolo-onnx.mjs`, que roda o mesmo caminho).
      const feeds: Record<string, TensorORT> = {
        [entrada]: new this.runtime.Tensor("float32", dados, [
          1,
          3,
          LADO_ENTRADA_YOLO,
          LADO_ENTRADA_YOLO,
        ]),
      };
      const resultado = await sessao.run(feeds);
      const tensor = resultado[saida];
      if (!tensor) throw new ErroPercepcao("detector", "Saida do YOLO vazia.");
      const deteccoes = interpretarSaidaYolo(
        tensor.data,
        tensor.dims,
        limiar,
        larguraOriginal,
        alturaOriginal
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
   * descartada de fato quando nenhum outro detector (COCO/NSFW) usa a mesma URL
   * (contagem de referencias em `obterSessaoYolo`/`liberarSessaoYolo`).
   */
  encerrar(): void {
    if (this.urlModelo) liberarSessaoYolo(this.urlModelo);
    this.sessao = null;
    this.runtime = null;
    this.urlModelo = null;
    this.modelo = null;
    this.dispositivo = "wasm";
  }
}
