import { IncomingMessage, ServerResponse } from "node:http";
import { ErroVisao, escolherModelo } from "../../visao";
import { normalizarPerfilDescricaoCorporal } from "../../nsfw-prompt";
import { configuracaoGemmaDoServidor, descricaoGemmaDoServidor } from "../../configuracao-gemma-servidor";
import { env } from "../../env";
import { ehCancelamento } from "../../erros";
import { EVENTOS_FILE, LOG_FILE, SNAP_DIR, VISAO_BODY_MAX_BYTES, logEvent, readBody, registrarFalha, sendJson } from "../base";
import { extrairImagens, validarPayloadVisao } from "../persistencia";
import type { ServerConfig } from "../servidor";
import { normalizarMarcacoesNsfw, normalizarMotivo } from "../validacao";
import { streamVisao } from "./stream";

export async function handleVisao(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig
): Promise<void> {
  let payload: unknown;
  try {
    const raw = await readBody(req, VISAO_BODY_MAX_BYTES);
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }

  const erroPayload = validarPayloadVisao(payload);
  if (erroPayload) {
    sendJson(res, 400, { ok: false, erro: erroPayload });
    return;
  }

  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const imagens = extrairImagens(p);
  if (imagens.length === 0) {
    sendJson(res, 400, { ok: false, erro: "campo 'imagem' ou 'imagens' obrigatorio (base64)" });
    return;
  }

  const perfilCorporal = normalizarPerfilDescricaoCorporal(p.perfilCorporal);
  // Configuracao unica do Gemma: o identificador pode vir de NEURO_MODELO_NSFW,
  // mas continua sendo o mesmo valor usado pelo cliente no diagnostico.
  const configGemma = configuracaoGemmaDoServidor();
  const modeloNsfw = configGemma.modelo;
  // NSFW ativo = marcacoes presentes (mesmo vazias) ou sinalizacao explicita
  // do fluxo multiframe. Nesse caso o modelo e sempre o Gemma configurado,
  // nunca a escolha da interface nem o padrao do servidor. O perfil neutro e
  // opt-in e vence a sinalizacao: ele nao pede descricao adulta explicita.
  const nsfwAtivo =
    perfilCorporal === "neutro"
      ? false
      : perfilCorporal === "nsfw" || p.nsfw !== undefined || p.nsfwAtivo === true;
  const modeloPedido = nsfwAtivo
    ? modeloNsfw
    : typeof p.modelo === "string"
      ? p.modelo
      : undefined;
  if (nsfwAtivo) {
    logEvent("info", "modelo_gemma_resolvido", { descricao: descricaoGemmaDoServidor() });
  }
  const escolha =
    modeloPedido !== undefined
      ? { solicitado: modeloPedido, modelo: modeloPedido, alternativo: false }
      : await escolherModelo({ baseUrl: config.backendUrl });
  if (nsfwAtivo && typeof p.modelo === "string" && p.modelo !== modeloNsfw) {
    logEvent("info", "modelo_nsfw_forcado", {
      solicitado: p.modelo,
      modelo: modeloNsfw,
    });
  }
  if (escolha.alternativo) {
    logEvent("info", "modelo_fallback", {
      solicitado: escolha.solicitado,
      modelo: escolha.modelo,
    });
  }

  try {
    await streamVisao(
      res,
      imagens,
      {
        modelo: escolha.modelo,
        baseUrl: config.backendUrl,
        timeoutMs: env.NEURO_VISION_TIMEOUT_MS,
        apiKey: config.apiKey,
        anterior: typeof p.anterior === "string" ? p.anterior : undefined,
        prompt: typeof p.prompt === "string" && p.prompt.trim() ? p.prompt : undefined,
        modo: p.modo === "roteiro" ? "roteiro" : "descricao",
        roteiro: typeof p.roteiro === "string" ? p.roteiro : undefined,
        base: p.base === true,
        motivo: normalizarMotivo(p.motivo),
        capturadoEm: typeof p.capturadoEm === "string" ? p.capturadoEm : undefined,
        frameIds: Array.isArray(p.frameIds)
          ? p.frameIds.filter((id): id is string => typeof id === "string")
          : undefined,
        contexto: typeof p.contexto === "string" ? p.contexto : undefined,
        perfilCorporal,
        nsfw: normalizarMarcacoesNsfw(p.nsfw),
      },
      config.logFile ?? LOG_FILE,
      config.snapDir ?? SNAP_DIR,
      config.eventosFile ?? EVENTOS_FILE,
      p.snapshot
    );
  } catch (err) {
    // Cancelamento (cliente desconectou/fechou a pagina) nao e falha: o fetch
    // do backend foi abortado de proposito. Registra explicitamente para o
    // diagnostico, sem responder a um cliente que ja foi embora.
    if (ehCancelamento(err)) {
      logEvent("info", "visao_cancelada", { cancelada: true });
      if (!res.writableEnded && res.headersSent) res.end();
      return;
    }
    const mensagem = (err as Error).message;
    const timeout = (err as Error).name === "TimeoutError";
    const status = err instanceof TypeError || err instanceof ErroVisao ? 502 : 500;
    registrarFalha("error", timeout ? "visao_timeout" : "visao_falhou", { status, erro: mensagem, timeout });
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, erro: timeout ? `Backend: tempo esgotado — ${mensagem}` : "Backend: " + mensagem });
    } else {
      res.write(JSON.stringify({ type: "erro", erro: (timeout ? "Backend: tempo esgotado — " : "Backend: ") + mensagem }) + "\n");
      res.end();
    }
  }
}
