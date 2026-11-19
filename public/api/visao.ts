import type { PreparacaoVisao, PayloadVisao, EventoVisao, ResultadoVisao } from "./http";
import { ErroEventoVisao } from "./http";
import { ErroPercepcao } from "../../src/erros";

export async function prepararVisao(modelo?: string): Promise<PreparacaoVisao> {
  const alvo = modelo?.trim();
  const url = alvo ? `/api/visao/preparar?modelo=${encodeURIComponent(alvo)}` : "/api/visao/preparar";
  let resposta: Response;
  try {
    resposta = await fetch(url);
  } catch (err) {
    throw new ErroPercepcao("visao", "Falha ao contactar o servidor (/api/visao/preparar)", {
      cause: err,
    });
  }
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("visao", corpo?.erro ?? `Falha ao preparar o backend de visao (${resposta.status})`);
  }
  return (await resposta.json()) as PreparacaoVisao;
}

export async function descreverFrame(
  payload: PayloadVisao,
  signal: AbortSignal,
  onChunk?: (parcial: string) => void
): Promise<ResultadoVisao> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/visao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ErroPercepcao("visao", "Falha ao contactar o servidor (/api/visao)", { cause: err });
  }

  if (!resposta.ok || !resposta.body) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("visao", corpo?.erro ?? `Backend de visao respondeu ${resposta.status}`);
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let parcial = "";
  let evento: EventoVisao | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!linha) continue;
        const evt = JSON.parse(linha) as EventoVisao;
        if (evt.type === "chunk" && evt.response) {
          parcial += evt.response;
          onChunk?.(parcial);
        } else if (evt.type === "done") {
          evento = evt;
        } else if (evt.type === "erro") {
          throw new ErroEventoVisao(evt.erro ?? "Erro no backend de visao");
        }
      }
    }
  } catch (err) {
    if (err instanceof ErroEventoVisao) throw err;
    if ((err as Error).name === "AbortError") throw err;
    throw new ErroPercepcao("visao", `Erro ao ler resposta do backend de visao: ${(err as Error).message}`, {
      cause: err,
    });
  }

  return { evento, parcial };
}