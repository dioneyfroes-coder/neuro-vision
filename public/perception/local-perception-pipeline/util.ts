export function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
