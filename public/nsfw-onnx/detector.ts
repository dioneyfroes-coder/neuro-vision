import { ErroPercepcao } from "../../src/erros";
import {
  LADO_ENTRADA_YOLO,
  carregarRuntimeYolo,
  decodificarImagem,
  dispositivoSessaoYolo,
  interpretarSaidaYolo,
  liberarSessaoYolo,
  obterSessaoYolo,
  rasterizar,
  rgbaParaTensorNCHW,
} from "../yolo-onnx";
import type {
  DeteccaoYOLO,
  MotorDeteccao,
  OpcoesInferenciaYolo,
  RuntimeORT,
  SessaoORT,
} from "../yolo-onnx";
import {
  CLASSES_NUDENET,
  MODELO_NSFW_PADRAO,
  definicaoModeloNsfw,
  limiarMinimoNsfw,
  urlModeloNsfw,
} from "./catalogo";
import {
  carregarRotulosNsfw,
  filtrarClassesNsfwRelevantes,
  filtrarDeteccoesNsfw,
  formatoSaidaNsfw,
  interpretarSaidaNudeNetCru,
} from "./interpretacao";

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
      const cru = formatoSaidaNsfw(tensor.dims) === "cru";
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
