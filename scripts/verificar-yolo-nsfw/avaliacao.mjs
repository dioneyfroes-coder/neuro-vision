import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { DIR_PESOS, EXTENSOES_VIDEO, ROOT } from "./constantes.mjs";
import { ladoDoModelo } from "./args.mjs";
import { servir } from "./servidor.mjs";
import { formatarBytes, memoriaDaAmostra } from "./relatorio.mjs";

export async function carregarRotulosModelo(chave) {
  const modelo = path.join(DIR_PESOS, `${chave}.onnx`);
  const sidecar = `${modelo}.json`;
  if (!existsSync(modelo)) {
    throw new Error(`modelo nao encontrado: ${path.relative(ROOT, modelo)} (exporte com scripts/exportar-yolo-nsfw.mjs)`);
  }
  if (!existsSync(sidecar)) {
    throw new Error(`sidecar de classes ausente: ${path.relative(ROOT, sidecar)} (reexporte o modelo)`);
  }
  const rotulos = JSON.parse(await readFile(sidecar, "utf8")).classes;
  if (!Array.isArray(rotulos) || rotulos.length === 0) {
    throw new Error("sidecar sem classes validas");
  }
  return { modelo, rotulos, lado: ladoDoModelo(chave) };
}

/**
 * Executa um modelo sobre as entradas e devolve um resumo para o benchmark do
 * conjunto. Lanca em qualquer falha de forma/rotulo/caixa.
 */
export async function verificarModelo(chave, config, entradas) {
  const { modelo, rotulos, lado } = await carregarRotulosModelo(chave);
  const servidor = await servir(0, modelo, entradas, config.isolamento);
  const porta = servidor.address().port;
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    const errosDePagina = [];
    pagina.on("pageerror", (e) => errosDePagina.push(String(e)));
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.waitForFunction(() => window.__carregada === true, null, { timeout: 60_000 });
    const r = await pagina.evaluate(
      ([rotulos, limiar, arquivos, amostras, lado]) =>
        window.__iniciar(
          rotulos,
          limiar,
          arquivos.map((arquivo, indice) => ({
            nome: arquivo.nome,
            url: `/entrada/${indice}`,
            video: arquivo.video,
          })),
          amostras,
          lado
        ),
      [
        rotulos,
        config.limiar,
        entradas.map((arquivo) => ({
          nome: path.relative(ROOT, arquivo),
          video: EXTENSOES_VIDEO.has(path.extname(arquivo).toLowerCase()),
        })),
        config.amostras,
        lado,
      ]
    );

    if (errosDePagina.length) {
      throw new Error(`erros na pagina: ${errosDePagina.join(" | ")}`);
    }

    console.log(`Modelo: ${chave}.onnx | entrada: ${lado}x${lado} | classes: ${rotulos.join(", ")}`);
    console.log(`Carga: ${r.msCarga} ms | limiar global: ${config.limiar} | execucao: WASM`);
    console.log(
      `Ambiente: crossOriginIsolated=${r.ambiente.crossOriginIsolated} | ` +
        `hardwareConcurrency=${r.ambiente.hardwareConcurrency} | numThreads=${r.ambiente.numThreads} | simd=${r.ambiente.simd}`
    );
    const memoriaAntes = memoriaDaAmostra(r.memoria.antes);
    const memoriaCarga = memoriaDaAmostra(r.memoria.aposCarga);
    const memoriaInferencia = memoriaDaAmostra(r.memoria.aposInferencia);
    const metodoMemoria = r.memoria.aposInferencia.metodo ?? "indisponivel";
    const wasmAntes = r.memoria.antes.wasmBytes ?? 0;
    const wasmCarga = r.memoria.aposCarga.wasmBytes ?? 0;
    const wasmInferencia = r.memoria.aposInferencia.wasmBytes ?? 0;
    console.log(
      `Memoria (${metodoMemoria}): wasm antes ${formatarBytes(wasmAntes)} | ` +
        `apos carga ${formatarBytes(wasmCarga)} (+${formatarBytes(wasmCarga - wasmAntes)}) | ` +
        `apos inferencia ${formatarBytes(wasmInferencia)} (+${formatarBytes(wasmInferencia - wasmAntes)}) | ` +
        `pico JS heap ${formatarBytes(r.memoria.picoJsHeapBytes)}`
    );
    const quadros = r.resultados.flatMap((entrada) =>
      entrada.frames.map((frame) => ({ ...frame, nome: entrada.nome }))
    );
    for (const entrada of r.resultados) {
      const deteccoes = entrada.frames.flatMap((frame) => frame.deteccoes);
      const resumo = Object.entries(
        deteccoes.reduce((contagem, deteccao) => {
          contagem[deteccao.label] = (contagem[deteccao.label] ?? 0) + 1;
          return contagem;
        }, {})
      )
        .map(([rotulo, quantidade]) => `${rotulo}:${quantidade}`)
        .join(", ");
      console.log(
        `${entrada.nome}: ${entrada.frames.length} quadro(s), ${deteccoes.length} marcacao(oes)` +
          (resumo ? ` (${resumo})` : " (nenhuma marcacao)")
      );
      if (config.detalhado) {
        entrada.frames.forEach((frame, indice) => {
          const quando =
            frame.emSegundos === null ? "imagem" : `t=${frame.emSegundos.toFixed(2)}s`;
          console.log(
            `  quadro ${indice + 1} (${quando}, ${frame.largura}x${frame.altura}, ${frame.msInferencia} ms, assinatura ${frame.assinatura}, dims ${frame.dims.join("x")}):`
          );
          if (frame.debug) {
            console.log(
              `    debug: linhas=${frame.debug.linhas} linhasSigmoid=${frame.debug.linhasSigmoid} scoreMin=${frame.debug.minScore} scoreMax=${frame.debug.maxScore}`
            );
          }
          if (frame.deteccoes.length === 0) {
            console.log("    nenhuma");
            return;
          }
          for (const d of frame.deteccoes) {
            console.log(
              `    ${d.label} ${d.score.toFixed(4)} [${d.xmin.toFixed(1)},${d.ymin.toFixed(1)},${d.xmax.toFixed(1)},${d.ymax.toFixed(1)}]`
            );
          }
        });
      }
    }

    const formaInvalida = quadros.find((frame) => {
      const dims = frame.dims;
      if (dims.length < 2) return true;
      const ultima = dims[dims.length - 1];
      const nms = dims[1] === 6 || ultima === 6;
      // Saida com NMS: [1,300,6] (ou [1,6,300]). Saida crua: 4 + nc colunas.
      if (nms) return ultima !== 6 && dims[1] !== 6;
      const colunas = 4 + rotulos.length;
      return dims[1] !== colunas && ultima !== colunas;
    });
    const fora = quadros.some((frame) =>
      frame.deteccoes.some(
        (d) => d.xmin < 0 || d.ymin < 0 || d.xmax > frame.largura || d.ymax > frame.altura
      )
    );
    const rotuloDesconhecido = quadros.some((frame) =>
      frame.deteccoes.some((d) => /^classe /.test(d.label))
    );
    if (formaInvalida) {
      throw new Error(`saida com forma inesperada (${formaInvalida.dims.join("x")})`);
    }
    if (fora) throw new Error("caixa fora dos limites do frame");
    if (rotuloDesconhecido) throw new Error("rotulo desconhecido (sidecar ausente/divergente)");
    console.log("OK: saida valida, caixas dentro dos limites e rotulos do sidecar.");

    const totalMarcacoes = quadros.reduce((soma, frame) => soma + frame.deteccoes.length, 0);
    const msInferenciaMedia = quadros.length
      ? Math.round(
          quadros.reduce((soma, frame) => soma + frame.msInferencia, 0) / quadros.length
        )
      : 0;
    return {
      chave,
      msCarga: r.msCarga,
      msInferenciaMedia,
      quadros: quadros.length,
      marcacoes: totalMarcacoes,
      memoriaAntesBytes: memoriaAntes,
      memoriaCargaBytes: memoriaCarga,
      memoriaInferenciaBytes: memoriaInferencia,
      picoJsHeapBytes: r.memoria.picoJsHeapBytes,
      memoriaMetodo: metodoMemoria,
      crossOriginIsolated: r.ambiente.crossOriginIsolated,
      numThreads: r.ambiente.numThreads,
    };
  } finally {
    await navegador.close();
    servidor.close();
  }
}