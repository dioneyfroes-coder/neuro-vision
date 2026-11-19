import { ServerResponse } from "node:http";
import { gerarDescricaoStream } from "../../visao";
import { deveTraduzir, traduzirTexto, type ModoAnalise } from "../../visao";
import { colapsarRepeticoes, cortarFraseIncompleta, ehSemMudanca } from "../../texto";
import type { EntradaLog, MarcacaoNsfwLog, MotivoAnalise, TipoEntrada } from "../../types";
import { agendarLimpezaSnapshots, appendLogEntry, salvarSnapshot } from "../persistencia";

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
