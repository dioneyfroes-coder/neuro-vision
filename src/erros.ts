/** Origem categorizada de um erro, para tratarmos cada falha pelo seu tipo. */
export type OrigemErro = "camera" | "detector" | "visao" | "armazenamento" | "cancelamento";

/**
 * Erro de percepcao com a origem explicita. Evita que o restante do codigo
 * precise inspecionar mensagens de texto para decidir como reagir.
 */
export class ErroPercepcao extends Error {
  constructor(
    public readonly origem: OrigemErro,
    mensagem: string,
    options?: { cause?: unknown }
  ) {
    super(mensagem, options);
    this.name = "ErroPercepcao";
  }
}

/** Indica se o erro recebido representa um cancelamento (AbortController). */
export function ehCancelamento(err: unknown): boolean {
  if (err instanceof ErroPercepcao) return err.origem === "cancelamento";
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}
