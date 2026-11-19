/**
 * Servico de arquivos estaticos, snapshots, pesos NSFW e artefatos offline.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";

import { MIME, PUBLIC_DIR } from "./base";

export function pathnameDecodificado(rawUrl: string | undefined): string | null {
  try {
    return decodeURIComponent(new URL(rawUrl ?? "/", "http://localhost").pathname);
  } catch {
    return null;
  }
}

export function resolverCaminhoDentroDaBase(baseDir: string, relPath: string): string | null {
  if (relPath.includes("\0")) return null;
  const base = path.resolve(baseDir);
  const destino = path.resolve(base, relPath);
  const relativo = path.relative(base, destino);
  if (
    relativo === "" ||
    relativo === ".." ||
    relativo.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativo)
  ) {
    return null;
  }
  return destino;
}

export function resolveStaticFile(rawUrl: string, publicDir: string = PUBLIC_DIR): string | null {
  const pathname = pathnameDecodificado(rawUrl);
  if (pathname === null) return null;
  const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!relPath) return null;
  return resolverCaminhoDentroDaBase(publicDir, relPath);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): void {
  const filePath = resolveStaticFile(req.url ?? "/", publicDir);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nao encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

export function serveSnapshot(
  req: IncomingMessage,
  res: ServerResponse,
  snapDir: string
): void {
  const pathname = pathnameDecodificado(req.url);
  if (pathname === null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requisicao invalida");
    return;
  }
  const rel = pathname.replace(/^\/snapshots\/?/, "");
  const filePath = resolverCaminhoDentroDaBase(snapDir, rel);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nao encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(data);
  });
}

/**
 * Serve os pesos NSFW experimentais de `modelos/yolonsfw/` (`.onnx` + sidecar
 * `.json` de rotulos). A pasta e gitignored: sem export, responde 404 — e o
 * cliente traduz isso em "rode scripts/exportar-yolo-nsfw.mjs".
 */
export function serveModeloNsfw(req: IncomingMessage, res: ServerResponse, nsfwDir: string): void {
  const pathname = pathnameDecodificado(req.url);
  if (pathname === null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requisicao invalida");
    return;
  }
  const rel = pathname.replace(/^\/yolonsfw\/?/, "");
  // Somente os artefatos do export: modelo ONNX e sidecar de classes.
  if (!/^[\w.-]+\.onnx(\.json)?$/.test(rel)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  const filePath = resolverCaminhoDentroDaBase(nsfwDir, rel);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nao encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(data);
  });
}

/**
 * Serve um arquivo do **modo offline** (`vendor/` ou `modelos/`), restrito a
 * uma allowlist de extensoes. As pastas sao gitignored: sem o download
 * (`npm run preparar:offline`) a rota responde 404 e o cliente usa o CDN.
 */
export function serveArquivoOffline(
  req: IncomingMessage,
  res: ServerResponse,
  baseDir: string,
  prefixo: RegExp,
  extensoes: RegExp
): void {
  const pathname = pathnameDecodificado(req.url);
  if (pathname === null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requisicao invalida");
    return;
  }
  const rel = pathname.replace(prefixo, "");
  if (!extensoes.test(rel)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  const filePath = resolverCaminhoDentroDaBase(baseDir, rel);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nao encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const cabecalhos = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (req.method === "HEAD") {
      res.writeHead(200, cabecalhos);
      res.end();
      return;
    }
    res.writeHead(200, cabecalhos);
    res.end(data);
  });
}
