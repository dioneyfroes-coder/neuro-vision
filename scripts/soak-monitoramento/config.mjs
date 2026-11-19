import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BASE = 1_700_000_000_000;
export const MB = 1024 * 1024;

export const PADRAO = {
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

export const CHAVES = {
  "--duracao-ms": "duracaoMs",
  "--tick-ms": "tickMs",
  "--acelerar": "acelerar",
  "--amostragem-ms": "amostragemMs",
  "--duracao-segmento-ms": "duracaoSegmentoMs",
  "--limiar-lacuna-ms": "limiarLacunaMs",
  "--max-crescimento-rss-mb": "maxCrescimentoRssMb",
  "--relatorio": "relatorio",
};

export function ajuda() {
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

export function inteiroPositivo(valor, nome, minimo = 1) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo) {
    throw new Error(`${nome} deve ser um inteiro >= ${minimo} (recebido: ${valor})`);
  }
  return numero;
}

export function decimalNaoNegativo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${nome} deve ser um número finito >= 0 (recebido: ${valor})`);
  }
  return numero;
}

export function parseCli(argv) {
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

export function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function numeroSeguro(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}
