export function ndjson(...eventos: unknown[]): Response {
  return new Response(eventos.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function sinal(): AbortSignal {
  return new AbortController().signal;
}
