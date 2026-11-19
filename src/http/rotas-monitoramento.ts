/**
 * Rotas de sessoes, quadros, comandos e segmentos de monitoramento.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { ConflitoMonitoramentoError } from "../monitoramento/servico-monitoramento";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { SessaoMonitoramento } from "../domain/monitoramento";
import { VideoSegment } from "../domain/monitoramento";

import { BODY_MAX_BYTES, readBody, registrarFalha, sendJson } from "./base";
import { inteiroLimitado, montarAgoraMonitoramento, montarInicioMonitoramento, montarQuadrosMonitoramento, parsearInstante } from "./validacao";

/** Conflito de estado responde 409; falha inesperada responde 500. */
export function responderErroMonitoramento(res: ServerResponse, err: unknown): void {
  const mensagem = (err as Error).message;
  if (err instanceof ConflitoMonitoramentoError) {
    sendJson(res, 409, { ok: false, erro: mensagem });
    return;
  }
  registrarFalha("error", "monitoramento_falhou", { erro: mensagem });
  sendJson(res, 500, { ok: false, erro: mensagem });
}

/** `POST /api/monitoramento/sessoes` - abre uma sessao de monitoramento. */
export async function handleIniciarMonitoramento(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }
  const opcoes = montarInicioMonitoramento(payload, Date.now());
  if (typeof opcoes === "string") {
    sendJson(res, 400, { ok: false, erro: opcoes });
    return;
  }
  try {
    const sessao = await monitoramento.iniciar(opcoes);
    sendJson(res, 200, { ok: true, sessao });
  } catch (err) {
    responderErroMonitoramento(res, err);
  }
}

/** `POST /api/monitoramento/quadros` - atribui um lote de quadros ao segmento. */
export async function handleQuadrosMonitoramento(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }
  const quadros = montarQuadrosMonitoramento(payload);
  if (typeof quadros === "string") {
    sendJson(res, 400, { ok: false, erro: quadros });
    return;
  }
  try {
    const resultado = await monitoramento.enviarQuadros(quadros);
    sendJson(res, 200, { ok: true, ...resultado });
  } catch (err) {
    responderErroMonitoramento(res, err);
  }
}

/** `POST /api/monitoramento/sessoes/:id/{pausar,retomar,encerrar,interromper}`. */
export async function handleComandoMonitoramento(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento,
  sessaoId: string,
  acao: "pausar" | "retomar" | "encerrar" | "interromper"
): Promise<void> {
  let agoraMs = Date.now();
  let motivo: "falha" | "sem_quadros" = "falha";
  if (acao === "encerrar" || acao === "interromper") {
    let payload: unknown;
    try {
      payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
    } catch (err) {
      sendJson(res, 400, { ok: false, erro: (err as Error).message });
      return;
    }
    const lido = montarAgoraMonitoramento(payload, agoraMs);
    if (typeof lido === "string") {
      sendJson(res, 400, { ok: false, erro: lido });
      return;
    }
    agoraMs = lido;
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >;
    if (p.motivo === "sem_quadros") motivo = "sem_quadros";
  }
  try {
    const sessao =
      acao === "pausar"
        ? await monitoramento.pausar(sessaoId)
        : acao === "retomar"
          ? await monitoramento.retomar(sessaoId)
          : acao === "encerrar"
            ? await monitoramento.encerrar(sessaoId, agoraMs)
            : await monitoramento.interromper(sessaoId, agoraMs, motivo);
    sendJson(res, 200, { ok: true, sessao });
  } catch (err) {
    responderErroMonitoramento(res, err);
  }
}

/** `GET /api/monitoramento/sessoes` - sessoes conhecidas (mais recente primeiro). */
export async function handleListarSessoesMonitoramento(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/monitoramento/sessoes", "http://localhost");
    const limite = inteiroLimitado(url.searchParams.get("limit"), 100, 1, 500);
    const sessoes: SessaoMonitoramento[] = await monitoramento.listarSessoes(limite);
    sendJson(res, 200, { ok: true, total: sessoes.length, sessoes });
  } catch (err) {
    registrarFalha("error", "listar_sessoes_monitoramento_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/** `GET /api/monitoramento/sessoes/:id/segmentos` - segmentos de uma sessao. */
export async function handleSegmentosDaSessaoMonitoramento(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const limite = inteiroLimitado(url.searchParams.get("limit"), 2000, 1, 5000);
    const segmentos: VideoSegment[] = await monitoramento.segmentosDaSessao(sessaoId, limite);
    sendJson(res, 200, { ok: true, total: segmentos.length, segmentos });
  } catch (err) {
    registrarFalha("error", "listar_segmentos_monitoramento_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/**
 * `GET /api/monitoramento/segmentos?inicio=&fim=` - segmentos que tocam o
 * intervalo, com extremos inclusivos. Sem `inicio`/`fim`, devolve o indice
 * inteiro em ordem cronologica.
 */
export async function handleListarSegmentosMonitoramento(
  req: IncomingMessage,
  res: ServerResponse,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/monitoramento/segmentos", "http://localhost");
    const inicioBruto = url.searchParams.get("inicio");
    const fimBruto = url.searchParams.get("fim");
    const inicioLido = inicioBruto === null ? undefined : parsearInstante(inicioBruto);
    const fimLido = fimBruto === null ? undefined : parsearInstante(fimBruto);
    if ((inicioBruto !== null && inicioLido === undefined) || (fimBruto !== null && fimLido === undefined)) {
      sendJson(res, 400, { ok: false, erro: "parametros 'inicio'/'fim' devem ser epoch ms ou ISO" });
      return;
    }
    const inicioMs = inicioLido ?? -Number.MAX_SAFE_INTEGER;
    const fimMs = fimLido ?? Number.MAX_SAFE_INTEGER;
    if (inicioMs > fimMs) {
      sendJson(res, 400, { ok: false, erro: "intervalo invertido" });
      return;
    }
    const limite = inteiroLimitado(url.searchParams.get("limit"), 2000, 1, 5000);
    const segmentos: VideoSegment[] = await monitoramento.segmentosParaIntervalo(
      inicioMs,
      fimMs,
      limite
    );
    sendJson(res, 200, { ok: true, total: segmentos.length, segmentos });
  } catch (err) {
    registrarFalha("error", "listar_segmentos_monitoramento_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/** Reconhece `/api/monitoramento/sessoes/:id/{acao}` e devolve id + acao. */
export function rotaSessaoMonitoramento(
  pathname: string
): { sessaoId: string; acao: "pausar" | "retomar" | "encerrar" | "interromper" | "segmentos" } | null {
  const encontrada =
    /^\/api\/monitoramento\/sessoes\/([^/]+)\/(pausar|retomar|encerrar|interromper|segmentos)$/.exec(
      pathname
    );
  if (!encontrada) return null;
  return {
    sessaoId: decodeURIComponent(encontrada[1]),
    acao: encontrada[2] as "pausar" | "retomar" | "encerrar" | "interromper" | "segmentos",
  };
}
