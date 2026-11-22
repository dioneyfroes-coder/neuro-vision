import { ErroPercepcao } from "../../src/erros";
import { paramsDeEventosTemporais, type FiltrosEventosTemporais } from "./eventos";

export type FormatoExportacao = "jsonl" | "csv";

/** Baixa o arquivo gerado pelo servidor, com metadados e filtros aplicados. */
export async function exportarEventos(
  formato: FormatoExportacao,
  filtros: FiltrosEventosTemporais = {}
): Promise<void> {
  const params = paramsDeEventosTemporais(filtros);
  params.set("formato", formato);
  let resposta: Response;
  try {
    resposta = await fetch(`/api/eventos/exportar?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao exportar eventos", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const blob = await resposta.blob();
  const disposicao = resposta.headers.get("content-disposition") ?? "";
  const nome = /filename="([^"]+)"/.exec(disposicao)?.[1] ?? `neuro-vision-eventos.${formato}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
