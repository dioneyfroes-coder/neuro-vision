import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../../src/server.ts";
import { BASE, ROOT, ajuda, dormir, numeroSeguro, parseCli } from "./config.mjs";
import { planejar } from "./planejamento.mjs";
import { criarCliente } from "./cliente.mjs";
import { concluir } from "./relatorio.mjs";

export async function main() {
  let config;
  try {
    config = parseCli(process.argv.slice(2));
  } catch (erro) {
    console.error(`[soak] ${erro.message}\n\n${ajuda()}`);
    process.exitCode = 2;
    return;
  }
  if (config.ajuda) {
    console.log(ajuda());
    return;
  }

  let servidor;
  let tmp;
  try {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "neuro-soak-"));
    // Backend indisponível de propósito: /api/health consulta /v1/models e um
    // localhost fechado falha rápido, sem 3 s de timeout por amostra. O soak não
    // usa inferência; apenas a telemetria real do processo servidor.
    servidor = createServer({
      logFile: path.join(tmp, "visao.jsonl"),
      publicDir: path.join(ROOT, "public"),
      videosDir: path.join(tmp, "videos"),
      videoRetencaoMs: 0,
      videoMaxArquivos: 0,
      backendUrl: "http://127.0.0.1:1",
    });
    await new Promise((resolve, reject) => {
      servidor.once("listening", resolve);
      servidor.once("error", reject);
      servidor.listen(0, "127.0.0.1");
    });
    const porta = servidor.address().port;
    const base = `http://127.0.0.1:${porta}`;

    const {
      passoMs,
      passos,
      duracaoSimuladaMs,
      lacunasInjetadas,
      duracaoSegmentoSessaoMs,
      limiarSessaoMs,
      notasDoHarness,
    } = planejar(config);
    const { buscar, errosHttp } = criarCliente();

    const inicio = await buscar(`${base}/api/monitoramento/sessoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ambiente: "soak",
        agoraMs: BASE,
        duracaoSegmentoMs: duracaoSegmentoSessaoMs,
        limiarLacunaMs: limiarSessaoMs,
      }),
    });
    const sessaoId = inicio.corpo?.sessao?.sessaoId;
    if (!inicio.ok || typeof sessaoId !== "string") {
      throw new Error(`Falha ao abrir sessão de monitoramento: ${JSON.stringify(inicio.corpo)}`);
    }

    const amostras = [];
    const videosFechados = [];
    const enviados = new Set();
    let segmentosFinais = [];
    let quadrosEsperados = 0;
    let quadrosEnviados = 0;
    let quadrosRejeitados = 0;
    let ultimaAmostraSimuladaMs = -Number.POSITIVE_INFINITY;
    let ultimaContagemSegmentos = 0;
    let indiceAmostras = 0;

    async function coletarAmostra(tempoSimuladoMs) {
      const resposta = await buscar(`${base}/api/health`);
      const sistema = resposta.corpo?.sistema ?? {};
      const cpu = sistema.cpu ?? {};
      const ram = sistema.ram ?? {};
      const armazenamento = sistema.armazenamento ?? {};
      const monitoramento = resposta.corpo?.monitoramento ?? {};
      const uso = cpu.usoPercentual;
      amostras.push({
        emMs: tempoSimuladoMs,
        usoPercentualCpu: typeof uso === "number" && Number.isFinite(uso) ? uso : null,
        rssBytes: numeroSeguro(ram.rssBytes),
        heapBytes: numeroSeguro(ram.heapUsedBytes),
        bytesVideo: numeroSeguro(armazenamento.bytesTotal),
        quadros: numeroSeguro(monitoramento.quadros),
        segmentos: numeroSeguro(monitoramento.segmentos),
        lacunas: numeroSeguro(monitoramento.lacunas),
      });
      indiceAmostras += 1;
      return monitoramento;
    }

    async function sincronizarSegmentos() {
      const resposta = await buscar(
        `${base}/api/monitoramento/sessoes/${encodeURIComponent(sessaoId)}/segmentos?limit=5000`
      );
      const lista = resposta.corpo?.segmentos;
      if (!resposta.ok || !Array.isArray(lista)) return 0;
      segmentosFinais = lista;
      if (config.semVideos) return lista.length;

      for (const segmento of lista) {
        if (segmento.estado === "gravando" || enviados.has(segmento.segmentoId)) continue;
        const respostaVideo = await buscar(
          `${base}/api/monitoramento/videos/${encodeURIComponent(segmento.segmentoId)}` +
            `?criadoEmMs=${segmento.fimMs}`,
          {
            method: "POST",
            headers: { "Content-Type": "video/webm" },
            body: Buffer.alloc(1024, 0),
          }
        );
        if (respostaVideo.ok && respostaVideo.corpo?.ok === true) {
          enviados.add(segmento.segmentoId);
          videosFechados.push(segmento.segmentoId);
        }
      }
      return lista.length;
    }

    console.log(
      `[soak] iniciando: ${passos} quadros, duração simulada ${duracaoSimuladaMs} ms, ` +
        `tick simulado ${passoMs} ms, ${lacunasInjetadas.length} lacunas`
    );
    const inicioRealMs = Date.now();

    for (let i = 0; i <= passos; i += 1) {
      if (config.acelerar === 1) {
        const espera = inicioRealMs + i * config.tickMs - Date.now();
        if (espera > 0) await dormir(espera);
      }
      const tempoSimuladoMs = Math.min(i * passoMs, duracaoSimuladaMs);
      const emLacuna = lacunasInjetadas.some(
        (janela) => tempoSimuladoMs >= janela.inicioMs && tempoSimuladoMs < janela.fimMs
      );

      if (!emLacuna) {
        quadrosEsperados += 1;
        const respostaQuadro = await buscar(`${base}/api/monitoramento/quadros`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quadros: [
              {
                frameId: `soak-${String(i).padStart(6, "0")}`,
                capturadoEmMs: BASE + tempoSimuladoMs,
              },
            ],
          }),
        });
        const rejeitados = respostaQuadro.corpo?.rejeitados;
        if (Array.isArray(rejeitados) && rejeitados.length > 0) {
          quadrosRejeitados += rejeitados.length;
          console.error(`[soak] quadro rejeitado: ${JSON.stringify(rejeitados[0])}`);
        } else if (respostaQuadro.ok && respostaQuadro.corpo?.ok === true) {
          quadrosEnviados += 1;
        }
      }

      if (tempoSimuladoMs - ultimaAmostraSimuladaMs >= config.amostragemMs) {
        const monitoramento = await coletarAmostra(tempoSimuladoMs);
        ultimaAmostraSimuladaMs = tempoSimuladoMs;
        const contagem = numeroSeguro(monitoramento?.segmentos);
        if (indiceAmostras % 5 === 0 || contagem > ultimaContagemSegmentos) {
          const total = await sincronizarSegmentos();
          if (total >= contagem) ultimaContagemSegmentos = contagem;
        }
      }
    }

    const fim = await buscar(
      `${base}/api/monitoramento/sessoes/${encodeURIComponent(sessaoId)}/encerrar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agoraMs: BASE + duracaoSimuladaMs }),
      }
    );
    if (!fim.ok) console.error("[soak] falha ao encerrar a sessão");

    await concluir({
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
      getSegmentos: () => segmentosFinais,
      quadrosEnviados,
      quadrosEsperados,
      lacunasInjetadas,
      videosFechados,
      errosHttp,
      quadrosRejeitados,
      notasDoHarness,
    });
  } catch (erro) {
    console.error(`[soak] falha: ${erro instanceof Error ? erro.stack ?? erro.message : erro}`);
    process.exitCode = 1;
  } finally {
    if (servidor?.listening) {
      await new Promise((resolve) => {
        servidor.close(() => resolve());
        servidor.closeIdleConnections?.();
      });
    }
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  }
}
