import path from "node:path";
import { MIME_ENTRADAS } from "./constantes.mjs";

export function obterMimeEntrada(caminho) {
  return MIME_ENTRADAS[path.extname(caminho).toLowerCase()];
}

export function validarAmostras(valor) {
  const amostras = Number(valor);
  if (!Number.isInteger(amostras) || amostras < 1 || amostras > 30) {
    throw new Error("--amostras precisa ser um inteiro entre 1 e 30");
  }
  return amostras;
}

/** Lado da entrada: NudeNet 320n usa 320x320; o restante usa 640x640. */
export function ladoDoModelo(chave) {
  return /320n/i.test(chave) ? 320 : 640;
}

export function parsearArgumentos(argumentos) {
  const config = {
    modelo: "erax_nsfw_yolo11n",
    entradas: [],
    limiar: 0.5,
    amostras: 5,
    fixturesNsfw: false,
    detalhado: false,
    conjunto: false,
    isolamento: true,
    ajuda: false,
  };
  let i = 0;
  if (argumentos[0] && !argumentos[0].startsWith("-")) {
    config.modelo = argumentos[0];
    i = 1;
  }
  let limiarDefinido = false;
  for (; i < argumentos.length; i += 1) {
    const argumento = argumentos[i];
    if (argumento === "--help" || argumento === "-h") {
      config.ajuda = true;
    } else if (argumento === "--fixtures-nsfw") {
      config.fixturesNsfw = true;
    } else if (argumento === "--detalhado" || argumento === "-v") {
      config.detalhado = true;
    } else if (argumento === "--conjunto") {
      config.conjunto = true;
    } else if (argumento === "--sem-isolamento") {
      config.isolamento = false;
    } else if (argumento === "--amostras") {
      const valor = argumentos[++i];
      if (valor === undefined) throw new Error("--amostras precisa de um valor");
      config.amostras = validarAmostras(valor);
    } else if (argumento === "--limiar") {
      const valor = Number(argumentos[++i]);
      if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
        throw new Error("--limiar precisa estar entre 0 e 1");
      }
      config.limiar = valor;
      limiarDefinido = true;
    } else if (argumento.startsWith("-")) {
      throw new Error(`opcao desconhecida: ${argumento}`);
    } else if (Number.isFinite(Number(argumento))) {
      const valor = Number(argumento);
      if (limiarDefinido || valor < 0 || valor > 1) {
        throw new Error("limiar posicional duplicado ou fora do intervalo [0,1]");
      }
      config.limiar = valor;
      limiarDefinido = true;
    } else {
      config.entradas.push(argumento);
    }
  }
  return config;
}