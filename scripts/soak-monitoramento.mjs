/**
 * Soak test do monitoramento com telemetria real (Fase 7).
 *
 * Executar com: node --import tsx scripts/soak-monitoramento.mjs [opções]
 *
 * O servidor de teste é isolado em um diretório temporário. Nenhum dado de
 * vídeo é gravado em logs/; somente o relatório JSON vai para logs/soak/.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.ts";
import { avaliarSoak } from "../src/monitoramento/validacao-soak.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = 1_700_000_000_000;
const MB = 1024 * 1024;

const PADRAO = {
  duracaoMs: 1_800_000,
  tickMs: 1_000,
  acelerar: 1,
  amostragemMs: 5_000,
  duracaoSegmentoMs: 10_000,
  limiarLacunaMs: 2_000,
  maxCrescimentoRssMb: 80,
  relatorio: "",
  semVideos: false,
  permitirInconclusivo: false,
  ajuda: false,
};

const CHAVES = {
  "--duracao-ms": "duracaoMs",
  "--tick-ms": "tickMs",
  "--acelerar": "acelerar",
  "--amostragem-ms": "amostragemMs",
  "--duracao-segmento-ms": "duracaoSegmentoMs",
  "--limiar-lacuna-ms": "limiarLacunaMs",
  "--max-crescimento-rss-mb": "maxCrescimentoRssMb",
  "--relatorio": "relatorio",
};

function ajuda() {
  return `Soak test de monitoramento (telemetria real do servidor)

Uso:
  node --import tsx scripts/soak-monitoramento.mjs [opções]

Opções:
  --duracao-ms N           duração total em ms (padrão ${PADRAO.duracaoMs} = 30 min)
  --tick-ms N              intervalo entre quadros, em ms (padrão ${PADRAO.tickMs})
  --acelerar N             inteiro >= 1; multiplica o tempo SIMULADO por tick (padrão 1)
  --amostragem-ms N        intervalo simulado entre leituras de /api/health (padrão ${PADRAO.amostragemMs})
  --duracao-segmento-ms N  duração alvo do segmento, em ms (padrão ${PADRAO.duracaoSegmentoMs})
  --limiar-lacuna-ms N     limiar de lacuna, em ms (padrão ${PADRAO.limiarLacunaMs})
  --max-crescimento-rss-mb N  limite de crescimento de RSS, em MB (padrão ${PADRAO.maxCrescimentoRssMb})
  --relatorio CAMINHO      JSON de saída (padrão logs/soak/relatorio-<ISO>.json)
  --sem-videos             não envia bytes; desativa a exigência de vídeo
  --permitir-inconclusivo  exit 0 mesmo quando o veredito for INCONCLUSIVO
  --ajuda                  mostra esta ajuda

Notas:
  - A quantidade de requisições é duracaoMs / tickMs, independente de --acelerar.
  - Sem --acelerar o loop respeita o tick real (30 min no padrão). Com --acelerar
    não há espera real: a execução termina no tempo das requisições.
  - Modo acelerado é diagnóstico: o veredito é sempre INCONCLUSIVO para aceite.`;
}

function inteiroPositivo(valor, nome, minimo = 1) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo) {
    throw new Error(`${nome} deve ser um inteiro >= ${minimo} (recebido: ${valor})`);
  }
  return numero;
}

function decimalNaoNegativo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${nome} deve ser um número finito >= 0 (recebido: ${valor})`);
  }
  return numero;
}

function parseCli(argv) {
  const config = { ...PADRAO };
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === "--ajuda" || argumento === "-h") {
      config.ajuda = true;
      continue;
    }
    if (argumento === "--sem-videos") {
      config.semVideos = true;
      continue;
    }
    if (argumento === "--permitir-inconclusivo") {
      config.permitirInconclusivo = true;
      continue;
    }
    const [chave, valorInline] = argumento.split("=", 2);
    const destino = CHAVES[chave];
    if (!destino) throw new Error(`Opção desconhecida: ${argumento}`);
    const valor = valorInline ?? argv[++i];
    if (valor === undefined || valor.startsWith("--")) {
      throw new Error(`A opção ${chave} exige um valor`);
    }
    config[destino] = valor;
  }

  config.duracaoMs = inteiroPositivo(config.duracaoMs, "--duracao-ms");
  config.tickMs = inteiroPositivo(config.tickMs, "--tick-ms");
  config.acelerar = inteiroPositivo(config.acelerar, "--acelerar");
  config.amostragemMs = inteiroPositivo(config.amostragemMs, "--amostragem-ms");
  config.duracaoSegmentoMs = inteiroPositivo(config.duracaoSegmentoMs, "--duracao-segmento-ms");
  config.limiarLacunaMs = inteiroPositivo(config.limiarLacunaMs, "--limiar-lacuna-ms");
  config.maxCrescimentoRssMb = decimalNaoNegativo(
    config.maxCrescimentoRssMb,
    "--max-crescimento-rss-mb"
  );

  if (config.duracaoMs % config.tickMs !== 0) {
    throw new Error("--duracao-ms deve ser um múltiplo inteiro de --tick-ms");
  }
  if (config.duracaoMs < 20 * config.tickMs) {
    throw new Error("--duracao-ms deve ser >= 20 * --tick-ms para acomodar as três lacunas");
  }
  if (config.duracaoSegmentoMs < 3 * config.tickMs) {
    throw new Error("--duracao-segmento-ms deve ser >= 3 * --tick-ms");
  }
  if (!config.relatorio) {
    config.relatorio = `logs/soak/relatorio-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  }
  return config;
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numeroSeguro(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

async function main() {
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

    const passoMs = config.tickMs * config.acelerar;
    const passos = Math.ceil(config.duracaoMs / config.tickMs);
    const duracaoSimuladaMs = passos * passoMs;

    // Janela de 3 ticks simulados (ou maior que o limiar), em tempo simulado.
    const janelaBrutaMs = Math.max(
      3 * passoMs,
      config.limiarLacunaMs + passoMs
    );
    const janelaMs = Math.min(janelaBrutaMs, Math.floor(0.19 * duracaoSimuladaMs));
    const lacunasInjetadas = [0.25, 0.55, 0.8].map((fração) => {
      const inicioMs = Math.round(duracaoSimuladaMs * fração);
      return { inicioMs, fimMs: inicioMs + janelaMs };
    });

    // Com acelerar > 1 o tick simulado cresce: escala a configuração da sessão
    // para que a cadência normal não seja classificada como lacuna.
    const duracaoSegmentoSessaoMs = config.duracaoSegmentoMs * config.acelerar;
    let limiarSessaoMs = Math.max(config.limiarLacunaMs * config.acelerar, passoMs);
    if (limiarSessaoMs >= janelaMs) limiarSessaoMs = Math.max(passoMs, janelaMs - passoMs);

    const notasDoHarness = [];
    if (config.acelerar > 1) {
      notasDoHarness.push(
        `Sessão com duracaoSegmentoMs=${duracaoSegmentoSessaoMs} e ` +
          `limiarLacunaMs=${limiarSessaoMs} (tempo simulado escalado por ${config.acelerar}x).`
      );
    }

    let errosHttp = 0;
    async function buscar(url, opcoes = {}) {
      const metodo = opcoes.method ?? "GET";
      try {
        const resposta = await fetch(url, {
          ...opcoes,
          signal: AbortSignal.timeout(10_000),
        });
        const texto = await resposta.text();
        let corpo = null;
        if (texto) {
          try {
            corpo = JSON.parse(texto);
          } catch {
            corpo = texto;
          }
        }
        if (!resposta.ok) {
          errosHttp += 1;
          console.error(`[soak] ${metodo} ${url} -> HTTP ${resposta.status}`);
        }
        return { ok: resposta.ok, status: resposta.status, corpo };
      } catch (erro) {
        errosHttp += 1;
        console.error(`[soak] ${metodo} ${url} -> ${erro instanceof Error ? erro.message : erro}`);
        return { ok: false, status: 0, corpo: null };
      }
    }

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

    await sincronizarSegmentos();
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
      segmentos: segmentosFinais,
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

await main();
