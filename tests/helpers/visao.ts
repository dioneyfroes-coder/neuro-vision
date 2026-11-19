/** Monta um corpo de stream SSE a partir de objetos por linha. */
export function sse(...linhas: object[]): string {
  return (
    linhas.map((l) => `data: ${JSON.stringify(l)}`).join("\n") + "\ndata: [DONE]\n"
  );
}