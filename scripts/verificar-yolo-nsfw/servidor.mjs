import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DIST_ORT, MIME, PAGINA_HTML } from "./constantes.mjs";
import { obterMimeEntrada } from "./args.mjs";

/**
 * Interpreta um cabecalho `Range` para um arquivo de `tamanho` bytes.
 *
 * - `undefined`: sem cabecalho (resposta 200 completa);
 * - `null`: faixa invalida/insatisfazivel (resposta 416);
 * - `{ inicio, fim }`: faixa inclusiva valida (resposta 206).
 *
 * O Chrome precisa de Range para fazer seek em video; sem isso `currentTime`
 * nao avanca e a amostragem devolve sempre o primeiro frame.
 */

export function interpretarFaixaBytes(cabecalho, tamanho) {
  if (typeof cabecalho !== "string" || !cabecalho) return undefined;
  const casamento = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!casamento) return null;
  const [, inicioTexto, fimTexto] = casamento;
  if (!inicioTexto && !fimTexto) return null;
  let inicio;
  let fim;
  if (!inicioTexto) {
    // `bytes=-N`: os ultimos N bytes.
    const sufixo = Number(fimTexto);
    if (!Number.isFinite(sufixo) || sufixo <= 0) return null;
    inicio = Math.max(0, tamanho - sufixo);
    fim = tamanho - 1;
  } else {
    inicio = Number(inicioTexto);
    fim = fimTexto ? Number(fimTexto) : tamanho - 1;
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  if (inicio < 0 || inicio >= tamanho || inicio > fim) return null;
  return { inicio, fim: Math.min(fim, tamanho - 1) };
}

export async function servir(porta, modelo, entradas, isolamento = true) {
  // HTML estatico: mesmo conteudo do antigo template literal, sem custo de parse.
  const html = await readFile(PAGINA_HTML);
  const pesos = await readFile(modelo);
  // COOP/COEP habilitam SharedArrayBuffer e o WASM multithread do ORT, igual ao
  // servidor do app. `--sem-isolamento` desliga para medir o efeito (1 thread).
  const cabecalhosIsolamento = isolamento
    ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      }
    : {};
  const servidor = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { ...cabecalhosIsolamento, "content-type": MIME[".html"] });
      res.end(html);
      return;
    }
    if (url.pathname === "/modelo.onnx") {
      res.writeHead(200, {
        ...cabecalhosIsolamento,
        "content-type": MIME[".onnx"],
        "content-length": pesos.length,
      });
      res.end(pesos);
      return;
    }
    const indiceEntrada = url.pathname.match(/^\/entrada\/(\d+)$/);
    if (indiceEntrada) {
      const entrada = entradas[Number(indiceEntrada[1])];
      if (!entrada) {
        res.writeHead(404).end();
        return;
      }
      const tamanho = statSync(entrada).size;
      const faixa = interpretarFaixaBytes(req.headers.range, tamanho);
      if (faixa === null) {
        res.writeHead(416, {
          ...cabecalhosIsolamento,
          "content-range": `bytes */${tamanho}`,
        });
        res.end();
        return;
      }
      if (faixa) {
        res.writeHead(206, {
          ...cabecalhosIsolamento,
          "content-type": obterMimeEntrada(entrada),
          "content-length": faixa.fim - faixa.inicio + 1,
          "content-range": `bytes ${faixa.inicio}-${faixa.fim}/${tamanho}`,
          "accept-ranges": "bytes",
        });
        createReadStream(entrada, { start: faixa.inicio, end: faixa.fim }).pipe(res);
        return;
      }
      res.writeHead(200, {
        ...cabecalhosIsolamento,
        "content-type": obterMimeEntrada(entrada),
        "content-length": tamanho,
        "accept-ranges": "bytes",
      });
      createReadStream(entrada).pipe(res);
      return;
    }
    if (url.pathname.startsWith("/ort/")) {
      const arquivo = path.join(DIST_ORT, path.basename(url.pathname));
      if (!arquivo.startsWith(DIST_ORT) || !existsSync(arquivo)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        ...cabecalhosIsolamento,
        "content-type": MIME[path.extname(arquivo)] || "application/octet-stream",
      });
      createReadStream(arquivo).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => servidor.listen(porta, "127.0.0.1", ok));
  return servidor;
}