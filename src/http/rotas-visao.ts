/**
 * Proxy/stream do backend de visao e preparacao de modelos.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { ErroVisao } from "../visao";
import { escolherModelo } from "../visao";
import { forcarCarregamento } from "../visao";
import { gerarDescricaoStream } from "../visao";
import { melhorModeloDisponivel } from "../visao";
import { mesmoModelo } from "../visao";
import { memoriaIntrospectavel } from "../visao";
import { modeloEmMemoria } from "../visao";
import { modelosEmMemoria } from "../visao";
import { MODELO_PADRAO } from "../visao";
import { traduzirTexto } from "../visao";
import { deveTraduzir } from "../visao";
import { type ModoAnalise } from "../visao";
import { cabecalhos } from "../provedor";
import { resolverBackend } from "../provedor";
import { urlModelos } from "../provedor";
import { colapsarRepeticoes } from "../texto";
import { cortarFraseIncompleta } from "../texto";
import { ehSemMudanca } from "../texto";
import { ehCancelamento } from "../erros";
import { EntradaLog } from "../types";
import { MarcacaoNsfwLog } from "../types";
import { MotivoAnalise } from "../types";
import { TipoEntrada } from "../types";
import { MODELO_NSFW } from "../nsfw-prompt";
import { env } from "../env";

import { EVENTOS_FILE, LOG_FILE, SNAP_DIR, VISAO_BODY_MAX_BYTES, logEvent, readBody, registrarFalha, sendJson } from "./base";
import { agendarLimpezaSnapshots, appendLogEntry, extrairImagens, salvarSnapshot, validarPayloadVisao } from "./persistencia";
import { ServerConfig } from "./servidor";
import { normalizarMarcacoesNsfw, normalizarMotivo } from "./validacao";

export async function streamVisao(
  res: ServerResponse,
  imagem: string | string[],
  opcoes: {
    modelo?: string;
    baseUrl?: string;
    timeoutMs?: number;
    anterior?: string;
    prompt?: string;
    modo?: ModoAnalise;
    roteiro?: string;
    base?: boolean;
    motivo?: MotivoAnalise;
    capturadoEm?: string;
    frameIds?: string[];
    /** Contexto/metadado declarado (nome do clipe, anotacao do usuario). */
    contexto?: string;
    /** Marcacoes NSFW normalizadas; `undefined` = subsistema desligado. */
    nsfw?: MarcacaoNsfwLog[];
    apiKey?: string;
  },
  logFile: string,
  snapDir: string,
  eventosFile: string,
  snapshot: unknown
): Promise<void> {
  // Se o cliente desconectar (cancelar/fechar a pagina), aborta o fetch do
  // backend de visao em vez de deixar a inferencia continuar consumindo recursos.
  const controle = new AbortController();
  res.once("close", () => controle.abort());
  const iterador = gerarDescricaoStream(imagem, { ...opcoes, signal: controle.signal });
  const primeiro = await iterador.next();
  if (primeiro.done) {
    throw new Error(
      "O backend de visao retornou um stream vazio (nenhum texto). Verifique se o modelo aceita imagens e se o backend permite gerar texto."
    );
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  let texto = primeiro.value;
  res.write(JSON.stringify({ type: "chunk", response: primeiro.value }) + "\n");

  let resultado = await iterador.next();
  while (!resultado.done) {
    texto += resultado.value;
    res.write(JSON.stringify({ type: "chunk", response: resultado.value }) + "\n");
    resultado = await iterador.next();
  }

  const resumo = resultado.value;
  let limpo = colapsarRepeticoes(cortarFraseIncompleta(texto));
  const tipo: TipoEntrada = opcoes.modo === "roteiro" ? "roteiro" : "descricao";
  const papel = opcoes.modo === "roteiro" ? (opcoes.base === true ? "base" : "delta") : undefined;
  const semMudanca = papel === "delta" && ehSemMudanca(limpo);

  if (!semMudanca) {
    if (deveTraduzir(limpo)) {
      const traduzido = await traduzirTexto({
        texto: limpo,
        baseUrl: opcoes.baseUrl,
        apiKey: opcoes.apiKey,
      });
      if (traduzido && traduzido !== limpo) {
        limpo = traduzido;
      }
    }
    const entry: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: resumo.modelo,
      objetos: [],
      resumo: limpo,
      tipo,
      papel,
      capturadoEm: opcoes.capturadoEm,
      ...(opcoes.frameIds?.length
        ? {
            frameIds: opcoes.frameIds,
            ...(opcoes.frameIds.length === 1 ? { frameId: opcoes.frameIds[0] } : {}),
          }
        : {}),
      ms: resumo.duracaoMs,
      tokens: resumo.tokens,
      motivo: opcoes.motivo,
      nsfw: opcoes.nsfw,
    };
    const snap = await salvarSnapshot(snapshot, snapDir);
    if (snap) entry.snapshot = snap;
    await appendLogEntry(entry, logFile);
    if (snap) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);

    res.write(
      JSON.stringify({
        type: "done",
        descricao: limpo,
        modelo: resumo.modelo,
        tokens: resumo.tokens,
        ms: resumo.duracaoMs,
        snapshot: entry.snapshot,
        tipo,
        papel,
        motivo: entry.motivo,
        nsfw: entry.nsfw,
        semMudanca: false,
      }) + "\n"
    );
  } else {
    res.write(
      JSON.stringify({
        type: "done",
        descricao: limpo,
        modelo: resumo.modelo,
        tokens: resumo.tokens,
        ms: resumo.duracaoMs,
        tipo,
        papel,
        semMudanca: true,
      }) + "\n"
    );
  }
  res.end();
}

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

  // NSFW ativo = marcacoes presentes (mesmo vazias) ou sinalizacao explicita
  // do fluxo multiframe. Nesse caso o modelo e sempre o `MODELO_NSFW`, nunca a
  // escolha da interface nem o padrao do servidor.
  const nsfwAtivo = p.nsfw !== undefined || p.nsfwAtivo === true;
  const modeloPedido = nsfwAtivo
    ? MODELO_NSFW
    : typeof p.modelo === "string"
      ? p.modelo
      : undefined;
  const escolha =
    modeloPedido !== undefined
      ? { solicitado: modeloPedido, modelo: modeloPedido, alternativo: false }
      : await escolherModelo({ baseUrl: config.backendUrl });
  if (nsfwAtivo && typeof p.modelo === "string" && p.modelo !== MODELO_NSFW) {
    logEvent("info", "modelo_nsfw_forcado", {
      solicitado: p.modelo,
      modelo: MODELO_NSFW,
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

export interface InfoVisao {
  online: boolean;
  /** URL base do backend consultado (para diagnostico da interface). */
  backend: string;
  /** Modelo de visao configurado (NEURO_MODEL ou o padrao). */
  solicitado: string;
  /** Modelo efetivamente usado (o solicitado ou o melhor disponivel). */
  modelo: string;
  modelos: string[];
  carregados: string[];
  erro: string;
}

export async function consultarVisao(baseUrl?: string): Promise<InfoVisao> {
  const backend = resolverBackend({ baseUrl });
  const solicitado = env.NEURO_MODEL !== "" ? env.NEURO_MODEL : MODELO_PADRAO;
  try {
    const resposta = await fetch(urlModelos(backend), {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(3000),
    });
    if (!resposta.ok) {
      return {
        online: false,
        backend: backend.baseUrl,
        solicitado,
        modelo: solicitado,
        modelos: [],
        carregados: [],
        erro: `HTTP ${resposta.status}`,
      };
    }
    const dados = (await resposta.json()) as {
      data?: { id?: string }[];
      models?: { id?: string }[];
    };
    const modelos = (dados.data ?? dados.models ?? []).map((m) => m.id ?? "");
    const nomes = modelos.filter((n) => n.length > 0);
    const carregados = await modelosEmMemoria({ baseUrl, timeoutMs: 3000 });
    // Alguns backends respondem `/v1/models` vazio mesmo com modelos baixados;
    // nesse caso usamos o REST v0 do LM Studio como fonte de diagnostico.
    const modelosValidos = nomes.length > 0 ? nomes : carregados;
    // Configurado instalado? Usa ele. Senao, cai para o melhor disponivel.
    const modelo =
      modelosValidos.length === 0 || modelosValidos.some((m) => mesmoModelo(m, solicitado))
        ? solicitado
        : melhorModeloDisponivel(modelosValidos) || solicitado;
    return {
      online: true,
      backend: backend.baseUrl,
      solicitado,
      modelo,
      modelos: modelosValidos,
      carregados,
      erro: "",
    };
  } catch (err) {
    return {
      online: false,
      backend: backend.baseUrl,
      solicitado,
      modelo: solicitado,
      modelos: [],
      carregados: [],
      erro: (err as Error).message,
    };
  }
}

export async function handlePreparar(
  res: ServerResponse,
  config: ServerConfig,
  modeloPedido?: string
): Promise<void> {
  // O cliente pode pedir um modelo especifico (seletor da interface); sem ele,
  // vale o configurado no ambiente (NEURO_MODEL ou o padrao do servidor).
  const pedido = modeloPedido?.trim();
  const escolha =
    pedido && pedido.length > 0
      ? { solicitado: pedido, modelo: pedido, alternativo: false }
      : await escolherModelo({ baseUrl: config.backendUrl });
  const modelo = escolha.modelo;
  if (escolha.alternativo) {
    logEvent("info", "modelo_fallback", {
      solicitado: escolha.solicitado,
      modelo,
    });
  }
  try {
    const carregandoMs = await forcarCarregamento({
      modelo,
      baseUrl: config.backendUrl,
      apiKey: config.apiKey,
    });
    // Quando o backend nao permite consultar a memoria (ex.: LM Studio sem
    // `/api/v0/models`), a carga bem-sucedida acima ja confirma o modelo.
    const emMemoria =
      (await modeloEmMemoria({ modelo, baseUrl: config.backendUrl })) ||
      !(await memoriaIntrospectavel({ modelo, baseUrl: config.backendUrl }));
    sendJson(res, 200, { ok: true, modelo, carregado: emMemoria, carregandoMs });
    logEvent("info", "modelo_preparado", { modelo, carregandoMs, carregado: emMemoria });
  } catch (err) {
    registrarFalha("error", "modelo_preparacao_falhou", { modelo, erro: (err as Error).message });
    sendJson(res, 502, { ok: false, erro: "Backend: " + (err as Error).message });
  }
}
