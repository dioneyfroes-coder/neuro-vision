import fs from "node:fs/promises";
import path from "node:path";
import { avaliarSoak } from "../../src/monitoramento/validacao-soak.ts";
import { BASE, ROOT } from "./config.mjs";

export async function concluir({
  base,
  buscar,
  coletarAmostra,
  sincronizarSegmentos,
  sessaoId,
  config,
  duracaoSimuladaMs,
  passoMs,
  duracaoSegmentoSessaoMs,
  limiarSessaoMs,
  amostras,
  getSegmentos,
  quadrosEnviados,
  quadrosEsperados,
  lacunasInjetadas,
  videosFechados,
  errosHttp,
  quadrosRejeitados,
  notasDoHarness,
}) {
    await sincronizarSegmentos();
    const segmentos = getSegmentos();
    const respostaVideos = await buscar(
      `${base}/api/monitoramento/videos?sessaoId=${encodeURIComponent(sessaoId)}`
    );
    const metadados = Array.isArray(respostaVideos.corpo?.arquivos)
      ? respostaVideos.corpo.arquivos
      : [];
    if (!config.semVideos) {
      notasDoHarness.push(
        `${metadados.length} arquivo(s) de vídeo listado(s) no índice para ${videosFechados.length} upload(s) bem-sucedido(s).`
      );
    }
    if (quadrosRejeitados > 0) {
      notasDoHarness.push(`${quadrosRejeitados} quadro(s) rejeitado(s) pelo servidor.`);
    }
    // Última leitura depois dos uploads: bytesVideoFinal reflete os bytes reais.
    await coletarAmostra(duracaoSimuladaMs);

    const resultado = avaliarSoak({
      amostras,
      segmentos,
      quadrosEnviados,
      quadrosEsperados,
      // Janelas relativas ao início da sessão convertidas para epoch ms, a
      // mesma linha do tempo das lacunas registradas nos segmentos.
      lacunasInjetadas: lacunasInjetadas.map((janela) => ({
        inicioMs: BASE + janela.inicioMs,
        fimMs: BASE + janela.fimMs,
      })),
      videosFechados,
      errosHttp,
      crescimentoRssMaxMb: config.maxCrescimentoRssMb,
      duracaoMs: duracaoSimuladaMs,
      acelerado: config.acelerar > 1,
      exigirVideos: !config.semVideos,
    });

    const relatorio = {
      data: new Date().toISOString(),
      config: { ...config, duracaoSimuladaMs, passoMs, duracaoSegmentoSessaoMs, limiarSessaoMs },
      metricas: resultado.metricas,
      veredito: resultado.veredito,
      problemas: resultado.problemas,
      notas: [...resultado.notas, ...notasDoHarness],
      amostras,
      lacunasInjetadas,
      videosFechados,
    };
    const caminhoRelatorio = path.resolve(ROOT, config.relatorio);
    await fs.mkdir(path.dirname(caminhoRelatorio), { recursive: true });
    await fs.writeFile(caminhoRelatorio, `${JSON.stringify(relatorio, null, 2)}\n`, "utf8");

    console.log(
      `[soak] veredito=${resultado.veredito} quadros=${resultado.metricas.quadrosContabilizados}/${quadrosEsperados} ` +
        `segmentos=${resultado.metricas.totalSegmentos} lacunas=${resultado.metricas.totalLacunas} ` +
        `RSS=${resultado.metricas.crescimentoRssMb.toFixed(2)}MB ` +
        `picoCPU=${resultado.metricas.picoCpuPercent ?? "null"}%`
    );
    if (resultado.problemas.length > 0) {
      console.error(`[soak] problemas: ${resultado.problemas.join(" | ")}`);
    }
    console.log(`[soak] relatório: ${caminhoRelatorio}`);

    if (resultado.veredito === "REPROVADO") process.exitCode = 1;
    if (resultado.veredito === "INCONCLUSIVO" && !config.permitirInconclusivo) {
      process.exitCode = 1;
    }
}
