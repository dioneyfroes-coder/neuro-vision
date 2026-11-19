import type { ArquivoVideoSegmento } from "../../src/persistence/armazenador-videos";
import { ErroPercepcao } from "../../src/erros";
import { exigirRespostaOk } from "./http";

export function urlVideoMonitoramento(segmentoId: string): string {
  return `/api/monitoramento/videos/${encodeURIComponent(segmentoId)}`;
}

export async function enviarVideoSegmento(opcoes: {
  segmentoId: string;
  bytes: Blob | Uint8Array;
  contentType: string;
  criadoEmMs?: number;
}): Promise<ArquivoVideoSegmento> {
  const params = new URLSearchParams();
  if (opcoes.criadoEmMs !== undefined) params.set("criadoEmMs", String(opcoes.criadoEmMs));
  const url = `${urlVideoMonitoramento(opcoes.segmentoId)}?${params.toString()}`;
  // `Uint8Array<ArrayBufferLike>` nao e `BodyInit` nas typings atuais; copiar
  // para um ArrayBuffer concreto mantem o contrato simples para o chamador.
  const corpo: Blob =
    opcoes.bytes instanceof Blob
      ? opcoes.bytes
      : new Blob([new Uint8Array(opcoes.bytes)], { type: opcoes.contentType });
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": opcoes.contentType },
      body: corpo,
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao enviar o video do segmento", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao enviar o video do segmento");
  const dados = (await resposta.json()) as { arquivo?: ArquivoVideoSegmento };
  if (!dados.arquivo) throw new ErroPercepcao("armazenamento", "Servidor nao devolveu o arquivo");
  return dados.arquivo;
}

export async function listarVideosMonitoramento(sessaoId?: string): Promise<ArquivoVideoSegmento[]> {
  const params = new URLSearchParams();
  if (sessaoId) params.set("sessaoId", sessaoId);
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/videos?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao listar os videos", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { arquivos?: ArquivoVideoSegmento[] };
  return dados.arquivos ?? [];
}

export function urlVideoSegmento(segmentoId: string): string {
  return urlVideoMonitoramento(segmentoId);
}

export async function excluirVideoSegmento(segmentoId: string): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(urlVideoMonitoramento(segmentoId), { method: "DELETE" });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao apagar o video", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao apagar o video");
}

export async function excluirVideosDaSessao(sessaoId: string): Promise<number> {
  const params = new URLSearchParams({ sessaoId });
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/videos?${params.toString()}`, {
      method: "DELETE",
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao apagar os videos da sessao", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao apagar os videos da sessao");
  const dados = (await resposta.json()) as { total?: number };
  return dados.total ?? 0;
}

export async function aplicarRetencaoVideos(agoraMs?: number): Promise<ArquivoVideoSegmento[]> {
  const params = new URLSearchParams();
  if (agoraMs !== undefined) params.set("agoraMs", String(agoraMs));
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/videos/retencao?${params.toString()}`, {
      method: "POST",
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao aplicar a retencao dos videos", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao aplicar a retencao dos videos");
  const dados = (await resposta.json()) as { removidos?: ArquivoVideoSegmento[] };
  return dados.removidos ?? [];
}