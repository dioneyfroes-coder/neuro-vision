import { blocoPerfilCorporal, resolverPerfilDescricaoCorporal } from "../nsfw-prompt";
import { interpretarLinha, montarRequisicaoChat, type Backend } from "../provedor";
import { ErroVisao, backendDe, resolverModelo } from "./comum";
import {
  PROMPT_ANALISE_PROFUNDA,
  montarPromptDescricao,
  montarPromptRoteiro,
  type OpcoesGerarDescricao,
} from "./prompts";

function montarCorpo(
  imagem: string | string[],
  opcoes: OpcoesGerarDescricao,
  stream: boolean
): { modelo: string; backend: Backend; requisicao: ReturnType<typeof montarRequisicaoChat> } {
  const modelo = resolverModelo(opcoes);
  const backend = backendDe(opcoes);
  const roteiro = opcoes.modo === "roteiro";
  const promptBase =
    opcoes.prompt ??
    (roteiro ? montarPromptRoteiro(opcoes.base === true, opcoes.roteiro) : montarPromptDescricao());
  const promptCompleto =
    opcoes.prompt === undefined
      ? promptBase
      : `${promptBase}\n\n${PROMPT_ANALISE_PROFUNDA}`;
  // Perfil de corpo: o bloco e anexado ao prompt padrao (um prompt explicito,
  // como o do ciclo multiframe, ja traz o proprio bloco e nao e duplicado).
  // O perfil `neutro` existe mesmo sem marcacoes; `nsfw` preserva o comportamento
  // historico exatamente, inclusive a exigencia de marcacoes presentes.
  const perfil = resolverPerfilDescricaoCorporal(
    opcoes.perfilCorporal,
    opcoes.nsfw !== undefined
  );
  const frameId = opcoes.frameIds?.length === 1 ? opcoes.frameIds[0] : undefined;
  const quadros = opcoes.nsfw
    ? [{ indice: 1, ...(frameId ? { frameId } : {}), marcacoes: opcoes.nsfw }]
    : [];
  const bloco = blocoPerfilCorporal(perfil, quadros, opcoes.contexto);
  const prompt = opcoes.prompt === undefined && bloco ? `${promptCompleto}\n\n${bloco}` : promptCompleto;
  const requisicao = montarRequisicaoChat({
    backend,
    modelo,
    prompt,
    ...(Array.isArray(imagem) ? { imagens: imagem } : { imagem }),
    stream,
    amostragem: {
      temperature: 0.2,
      top_p: 0.9,
    },
  });
  return { modelo, backend, requisicao };
}

function lancarSeVazioSemResposta(
  vistoPensamento: boolean,
  modelo: string,
  motivoFim?: string
): never {
  if (vistoPensamento) {
    const dica =
      motivoFim === "length"
        ? "o backend encerrou a geracao antes de produzir texto (finish_reason=length); " +
          "verifique o limite de tokens e o contexto configurados no backend. " +
          "Para repetir com menos frames, use ?orcamentoTokens=leve."
        : 'o backend ignorou o desligamento do "thinking"; use um modelo de visao nao-pensante (ex.: qwen2.5-vl).';
    throw new ErroVisao(`o modelo ${modelo} derivou/raciocinou sem produzir resposta: ${dica}`);
  }
  throw new ErroVisao(
    `o modelo ${modelo} nao retornou nenhum token de texto. ` +
      "Verifique se o modelo carregado no backend aceita imagens e se a configuracao de saida permite gerar texto."
  );
}

export interface ResumoDescricao {
  modelo: string;
  tokens: number;
  duracaoMs: number;
}

export async function* gerarDescricaoStream(
  imagem: string | string[],
  opcoes: OpcoesGerarDescricao = {}
): AsyncGenerator<string, ResumoDescricao, void> {
  const timeoutMs = opcoes.timeoutMs ?? 300_000;
  const { modelo, requisicao } = montarCorpo(imagem, opcoes, true);

  const inicio = performance.now();
  const sinais: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (opcoes.signal) sinais.push(opcoes.signal);
  const resposta = await fetch(requisicao.url, {
    method: "POST",
    headers: requisicao.headers,
    body: requisicao.body,
    signal: AbortSignal.any(sinais),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroVisao(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  if (!resposta.body) {
    throw new Error("o backend de visao nao retornou corpo de streaming");
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let modeloFinal = modelo;
  let tokens = 0;
  let duracaoMs = 0;
  let emitiuTexto = false;
  let pensou = false;
  let motivoFim: string | undefined;

  const processarLinha = (linha: string): string | undefined => {
    const evt = interpretarLinha(linha);
    if (!evt) return undefined;
    if (evt.erro) throw new ErroVisao(evt.erro);
    if (evt.modelo) modeloFinal = evt.modelo;
    if (evt.texto) emitiuTexto = true;
    if (evt.pensou) pensou = true;
    if (evt.motivoFim) motivoFim = evt.motivoFim;
    if (evt.tokens !== undefined) tokens = evt.tokens;
    if (evt.done) duracaoMs = evt.duracaoMs ?? Math.round(performance.now() - inicio);
    return evt.texto;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const texto = processarLinha(linha);
        if (texto) yield texto;
      }
    }
    buffer += decoder.decode();
    const textoFinal = processarLinha(buffer);
    if (textoFinal) yield textoFinal;
  } finally {
    reader.releaseLock();
  }

  if (!emitiuTexto) lancarSeVazioSemResposta(pensou, modeloFinal, motivoFim);
  return { modelo: modeloFinal, tokens, duracaoMs };
}
