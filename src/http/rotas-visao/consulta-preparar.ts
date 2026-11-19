import { ServerResponse } from "node:http";
import { escolherModelo, forcarCarregamento, melhorModeloDisponivel, memoriaIntrospectavel, mesmoModelo, modeloEmMemoria, modelosEmMemoria, MODELO_PADRAO } from "../../visao";
import { cabecalhos, resolverBackend, urlModelos } from "../../provedor";
import { env } from "../../env";
import { logEvent, registrarFalha, sendJson } from "../base";
import type { ServerConfig } from "../servidor";

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
