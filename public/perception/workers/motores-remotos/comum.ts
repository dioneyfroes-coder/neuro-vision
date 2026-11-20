import { ErroWorker } from "../cliente-worker";

export function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function normalizarDispositivo(valor: string | null | undefined): "webgpu" | "wasm" | null {
  if (valor === "webgpu" || valor === "wasm") return valor;
  return null;
}

export function avisoFallback(
  aoStatus: ((mensagem: string) => void) | undefined,
  motor: string,
  erro: unknown
): string {
  const detalhe = mensagemDe(erro);
  const origem = erro instanceof ErroWorker ? "worker" : "motor";
  const mensagem = `${origem} de ${motor} indisponivel (${detalhe}); usando a thread principal.`;
  aoStatus?.(mensagem);
  return mensagem;
}
