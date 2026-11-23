import { ServerResponse } from "node:http";
import { escolherModelo, forcarCarregamento, melhorModeloDisponivel, memoriaIntrospectavel, mesmoModelo, modeloEmMemoria, modelosEmMemoria, MODELO_PADRAO } from "../../visao";
import {
  avaliarDisponibilidadeGemma,
  erroLegivelGemma,
  planoWarmupGemma,
  type DiagnosticoDisponibilidadeGemma,
} from "../../domain/disponibilidade-gemma";
import { configuracaoGemmaDoServidor, descricaoGemmaDoServidor } from "../../configuracao-gemma-servidor";
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
  /** Modelo Gemma configurado para o modo NSFW (Fase 5). */
  modeloNsfw: string;
  /** Disponibilidade do Gemma, separada da percepção local. */
  gemma: DiagnosticoDisponibilidadeGemma;
}

export async function consultarVisao(baseUrl?: string): Promise<InfoVisao> {
  const backend = resolverBackend({ baseUrl });
  const solicitado = env.NEURO_MODEL !== "" ? env.NEURO_MODEL : MODELO_PADRAO;
  const configGemma = configuracaoGemmaDoServidor();
  const gemmaDe = (
    online: boolean,
    modelos: string[] = [],
    carregados: string[] = [],
    erro = ""
  ): DiagnosticoDisponibilidadeGemma =>
    avaliarDisponibilidadeGemma({
      modelo: configGemma.modelo,
      online,
      modelos,
      carregados,
      erro,
    });
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
        modeloNsfw: configGemma.modelo,
        gemma: gemmaDe(false, [], [], `HTTP ${resposta.status}`),
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
      modeloNsfw: configGemma.modelo,
      gemma: gemmaDe(true, modelosValidos, carregados),
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
      modeloNsfw: configGemma.modelo,
      gemma: gemmaDe(false, [], [], (err as Error).message),
    };
  }
}

export async function handlePreparar(
  res: ServerResponse,
  config: ServerConfig,
  modeloPedido?: string,
  opcoes: { nsfw?: boolean } = {}
): Promise<void> {
  const configGemma = configuracaoGemmaDoServidor();
  if (opcoes.nsfw) {
    // Modo NSFW: o warm-up prepara somente o Gemma configurado. Nunca usa
    // `escolherModelo` (que pode trocar por um modelo SFW disponível) e nunca
    // troca silenciosamente o identificador pedido pelo usuario.
    const plano = planoWarmupGemma(configGemma.modelo);
    logEvent("info", "warmup_gemma_iniciado", {
      descricao: descricaoGemmaDoServidor(),
      etapas: plano.etapas.join(" > "),
    });
    if (modeloPedido && modeloPedido.trim() !== "" && modeloPedido.trim() !== configGemma.modelo) {
      registrarFalha("warn", "warmup_gemma_modelo_ignorado", {
        solicitado: modeloPedido.trim(),
        modelo: configGemma.modelo,
      });
      sendJson(res, 400, {
        ok: false,
        erro: `NSFW exige o Gemma ${configGemma.modelo}; o modelo ${modeloPedido.trim()} nao pode substitui-lo.`,
        solicitado: modeloPedido.trim(),
        modelo: configGemma.modelo,
      });
      return;
    }
  }

  // O cliente pode pedir um modelo especifico (seletor da interface); sem ele,
  // vale o configurado no ambiente (NEURO_MODEL ou o padrao do servidor).
  const pedido = modeloPedido?.trim();
  const escolha = opcoes.nsfw
    ? { solicitado: configGemma.modelo, modelo: configGemma.modelo, alternativo: false }
    : pedido && pedido.length > 0
      ? { solicitado: pedido, modelo: pedido, alternativo: false }
      : await escolherModelo({ baseUrl: config.backendUrl });
  const modelo = escolha.modelo;
  const solicitado = escolha.solicitado;
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
    const gemma = opcoes.nsfw
      ? avaliarDisponibilidadeGemma({
          modelo: configGemma.modelo,
          online: true,
          modelos: [configGemma.modelo],
          carregados: emMemoria ? [configGemma.modelo] : [],
        })
      : undefined;
    sendJson(res, 200, {
      ok: true,
      solicitado,
      modelo,
      carregado: emMemoria,
      carregandoMs,
      ...(gemma ? { gemma } : {}),
    });
    logEvent("info", "modelo_preparado", {
      solicitado,
      modelo,
      carregandoMs,
      carregado: emMemoria,
    });
  } catch (err) {
    const mensagem = (err as Error).message;
    const gemma = opcoes.nsfw
      ? avaliarDisponibilidadeGemma({
          modelo: configGemma.modelo,
          online: false,
          erro: mensagem,
        })
      : undefined;
    registrarFalha("error", "modelo_preparacao_falhou", { modelo, erro: mensagem });
    sendJson(res, 502, {
      ok: false,
      erro: gemma ? erroLegivelGemma(gemma) : "Backend: " + mensagem,
      solicitado,
      modelo,
      ...(gemma ? { gemma } : {}),
    });
  }
}
