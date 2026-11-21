/**
 * Rotas de upload, consulta, exclusao e retencao de videos.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { ArmazenadorVideos } from "../persistence/armazenador-videos";
import { ArquivoVideoError } from "../persistence/armazenador-videos";
import { ArquivoVideoSegmento } from "../persistence/armazenador-videos";
import { DadosUploadVideo } from "../persistence/armazenador-videos";

import { VIDEO_UPLOAD_MAX_BYTES, readBodyBuffer, registrarFalha, sendJson } from "./base";
import { lerInstanteDoCorpo } from "./validacao";

/* ------------------------------------------------------------------------- *
 * Bytes de video (Fase 3) - upload, download, retencao e exclusao
 * ------------------------------------------------------------------------- */

/** Motivos de validacao viram 400/404/409; o resto e falha interna. */
export function responderErroVideo(res: ServerResponse, err: unknown): void {
  if (err instanceof ArquivoVideoError) {
    const status =
      err.motivo === "nao_encontrado"
        ? 404
        : err.motivo === "conflito" || err.motivo === "segmento_aberto"
          ? 409
          : 400;
    sendJson(res, status, { ok: false, erro: err.message, motivo: err.motivo });
    return;
  }
  registrarFalha("error", "video_monitoramento_falhou", { erro: (err as Error).message });
  sendJson(res, 500, { ok: false, erro: (err as Error).message });
}

/** `POST /api/monitoramento/videos/:segmentoId` - corpo binario + Content-Type. */
export async function handleUploadVideo(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento,
  armazenador: ArmazenadorVideos,
  segmentoId: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const lido = lerInstanteDoCorpo(url.searchParams.get("criadoEmMs") ?? undefined);
    if (lido !== undefined && !Number.isFinite(lido)) {
      sendJson(res, 400, { ok: false, erro: "parametro 'criadoEmMs' deve ser finito" });
      return;
    }
    const segmento = await monitoramento.segmentoPorId(segmentoId);
    if (!segmento) {
      sendJson(res, 404, { ok: false, erro: "Segmento de monitoramento desconhecido" });
      return;
    }
    const cabecalho = req.headers["content-type"];
    const contentType = Array.isArray(cabecalho) ? (cabecalho[0] ?? "") : (cabecalho ?? "");
    let bytes: Buffer;
    try {
      bytes = await readBodyBuffer(req, VIDEO_UPLOAD_MAX_BYTES);
    } catch (err) {
      sendJson(res, 400, { ok: false, erro: (err as Error).message });
      return;
    }
    const dados: DadosUploadVideo = {
      bytes,
      contentType,
      criadoEmMs: lido ?? Date.now(),
    };
    const arquivo = await armazenador.guardar(segmento, dados);
    // Retencao e operacao de limpeza: falha nela nao invalida o upload feito,
    // mas a limpeza termina antes da resposta para que uma consulta imediata
    // já reflita o estado final do diretorio.
    await armazenador.aplicarRetencao(Date.now()).catch((err: unknown) => {
      registrarFalha("error", "retencao_videos_falhou", { erro: (err as Error).message });
    });
    sendJson(res, 201, { ok: true, arquivo });
  } catch (err) {
    responderErroVideo(res, err);
  }
}

/** `GET /api/monitoramento/videos` - metadados, com filtro opcional por sessao. */
export async function handleListarVideos(
  req: IncomingMessage,
  res: ServerResponse,
  armazenador: ArmazenadorVideos
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const sessaoId = url.searchParams.get("sessaoId") ?? undefined;
    const arquivos: ArquivoVideoSegmento[] = await armazenador.listar(sessaoId);
    sendJson(res, 200, { ok: true, total: arquivos.length, arquivos });
  } catch (err) {
    responderErroVideo(res, err);
  }
}

function parseRange(rangeHeader: string | undefined, tamanho: number): { inicio: number; fim: number } | null {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  const inicioBruto = m[1];
  const fimBruto = m[2];
  if (inicioBruto === "" && fimBruto === "") return null;
  let inicio: number;
  let fim: number;
  if (inicioBruto === "") {
    const sufixo = Number(fimBruto);
    if (!Number.isFinite(sufixo) || sufixo <= 0) return null;
    inicio = Math.max(0, tamanho - sufixo);
    fim = tamanho - 1;
  } else {
    inicio = Number(inicioBruto);
    fim = fimBruto === "" ? tamanho - 1 : Number(fimBruto);
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  if (inicio < 0 || fim < inicio || inicio >= tamanho) return null;
  fim = Math.min(fim, tamanho - 1);
  return { inicio, fim };
}

/** `GET /api/monitoramento/videos/:id` - bytes brutos do segmento, com suporte a Range. */
export async function handleObterVideo(
  req: IncomingMessage,
  res: ServerResponse,
  armazenador: ArmazenadorVideos,
  segmentoId: string
): Promise<void> {
  try {
    const encontrado = await armazenador.obter(segmentoId);
    if (!encontrado) {
      sendJson(res, 404, { ok: false, erro: "Video nao encontrado" });
      return;
    }
    const total = encontrado.bytes.length;
    const range = parseRange(req.headers.range, total);
    const baseHeaders = {
      "Content-Type": encontrado.arquivo.contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
    if (!range) {
      res.writeHead(200, { ...baseHeaders, "Content-Length": total });
      res.end(encontrado.bytes);
      return;
    }
    const { inicio, fim } = range;
    const chunk = encontrado.bytes.subarray(inicio, fim + 1);
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Range": `bytes ${inicio}-${fim}/${total}`,
      "Content-Length": chunk.length,
    });
    res.end(chunk);
  } catch (err) {
    responderErroVideo(res, err);
  }
}

/** `DELETE /api/monitoramento/videos/:id` - apaga um segmento. */
export async function handleExcluirVideo(
  res: ServerResponse,
  armazenador: ArmazenadorVideos,
  segmentoId: string
): Promise<void> {
  try {
    const excluido = await armazenador.excluir(segmentoId);
    if (!excluido) {
      sendJson(res, 404, { ok: false, erro: "Video nao encontrado" });
      return;
    }
    registrarFalha("info", "video_excluido", { segmentoId });
    sendJson(res, 200, { ok: true, excluido: true });
  } catch (err) {
    responderErroVideo(res, err);
  }
}

/** `DELETE /api/monitoramento/videos?sessaoId=` - apaga todos os videos da sessao. */
export async function handleExcluirVideosSessao(
  req: IncomingMessage,
  res: ServerResponse,
  armazenador: ArmazenadorVideos
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const sessaoId = url.searchParams.get("sessaoId");
    if (!sessaoId) {
      sendJson(res, 400, { ok: false, erro: "parametro 'sessaoId' obrigatorio" });
      return;
    }
    const removidos = await armazenador.excluirSessao(sessaoId);
    registrarFalha("info", "videos_sessao_excluidos", {
      sessaoId,
      total: removidos.length,
      segmentos: removidos.map((arquivo) => arquivo.segmentoId),
    });
    sendJson(res, 200, { ok: true, total: removidos.length, removidos });
  } catch (err) {
    responderErroVideo(res, err);
  }
}

/** `POST /api/monitoramento/videos/retencao?agoraMs=` - aplica a politica. */
export async function handleRetencaoVideos(
  req: IncomingMessage,
  res: ServerResponse,
  armazenador: ArmazenadorVideos
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const lido = lerInstanteDoCorpo(url.searchParams.get("agoraMs") ?? undefined);
    if (lido !== undefined && !Number.isFinite(lido)) {
      sendJson(res, 400, { ok: false, erro: "parametro 'agoraMs' deve ser finito" });
      return;
    }
    const removidos = await armazenador.aplicarRetencao(lido ?? Date.now());
    if (removidos.length > 0) {
      registrarFalha("info", "retencao_videos_aplicada", {
        total: removidos.length,
        segmentos: removidos.map((arquivo) => arquivo.segmentoId),
      });
    }
    sendJson(res, 200, { ok: true, total: removidos.length, removidos });
  } catch (err) {
    responderErroVideo(res, err);
  }
}
