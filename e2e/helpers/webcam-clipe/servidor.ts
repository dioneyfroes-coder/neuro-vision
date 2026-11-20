import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import type { ServidorClipe } from "./ambiente";

export function mimeDoClipe(clip: string): string {
    const extensao = path.extname(clip).toLowerCase();
    const mime = extensao === ".webm" ? "video/webm" : extensao === ".mp4" ? "video/mp4" : null;
    if (!mime) throw new Error(`formato de clipe nao suportado: ${extensao || "(sem extensao)"}`);
  return mime;
}

export function criarServidorClipe(clip: string, mime: string): ServidorClipe {
    const tamanhoClipe = statSync(clip).size;
    return createServer((req, res) => {
      if (req.url !== "/clip") {
        res.writeHead(404).end();
        return;
      }
      const cabecalhos = {
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
        "Content-Type": mime,
      };
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (req.headers.range && !range) {
        res.writeHead(416, { "Content-Range": `bytes */${tamanhoClipe}` }).end();
        return;
      }
      if (range) {
        const tamanhoSufixo = range[2] ? Number(range[2]) : 0;
        const inicioRange = range[1]
          ? Number(range[1])
          : Math.max(0, tamanhoClipe - tamanhoSufixo);
        const fimRange = range[1] && range[2]
          ? Math.min(Number(range[2]), tamanhoClipe - 1)
          : tamanhoClipe - 1;
        if (
          !Number.isInteger(inicioRange) ||
          !Number.isInteger(fimRange) ||
          inicioRange > fimRange ||
          inicioRange >= tamanhoClipe
        ) {
          res.writeHead(416, { "Content-Range": `bytes */${tamanhoClipe}` }).end();
          return;
        }
        res.writeHead(206, {
          ...cabecalhos,
          "Content-Length": fimRange - inicioRange + 1,
          "Content-Range": `bytes ${inicioRange}-${fimRange}/${tamanhoClipe}`,
        });
        createReadStream(clip, { start: inicioRange, end: fimRange }).pipe(res);
        return;
      }
      res.writeHead(200, { ...cabecalhos, "Content-Length": tamanhoClipe });
      createReadStream(clip).pipe(res);
    });
}

export async function escutarServidorClipe(servidor: ServidorClipe): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      servidor.once("error", reject);
      servidor.listen(0, "127.0.0.1", resolve);
    });
    const enderecoClipe = servidor.address();
    if (!enderecoClipe || typeof enderecoClipe === "string") {
      throw new Error("nao foi possivel iniciar servidor local do clipe");
    }
    return `http://127.0.0.1:${enderecoClipe.port}/clip`;
}
