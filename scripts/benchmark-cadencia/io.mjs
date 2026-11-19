/** Le e parseia um JSONL; linhas invalidas sao contadas e ignoradas. */
export function lerCiclosJsonl(texto) {
  const registros = [];
  let invalidas = 0;
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      registros.push(JSON.parse(limpa));
    } catch {
      invalidas += 1;
    }
  }
  return { registros, invalidas };
}
