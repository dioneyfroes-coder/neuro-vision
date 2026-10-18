/**
 * Primitivas de armazenamento JSONL (Etapa 8 do roteiro).
 *
 * Operacoes genericas de arquivo usadas pelos repositorios de observacoes,
 * eventos, ciclos e registros operacionais: gravacao append-only com rotacao por
 * tamanho, leitura das ultimas linhas e limpeza. Esta camada nao conhece o
 * dominio: recebe e devolve `T` generico, para que os repositorios tratem dos
 * contratos.
 */
import fs from "node:fs";
import path from "node:path";

/** Rotaciona um JSONL para `.1` quando passa de `maxBytes`. */
export async function rotacionarJsonl(filePath: string, maxBytes: number): Promise<void> {
  try {
    const info = await fs.promises.stat(filePath);
    if (info.size < maxBytes) return;
  } catch {
    return;
  }
  await fs.promises.rename(filePath, `${filePath}.1`).catch(() => {});
}

/** Acrescenta um registro JSON como uma linha, criando diretorios e rotacionando. */
export async function appendJsonl<T>(
  registro: T,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await rotacionarJsonl(filePath, maxBytes);
  await fs.promises.appendFile(filePath, JSON.stringify(registro) + "\n", "utf8");
}

async function lerUltimasLinhas(filePath: string, alvo: number): Promise<string[]> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    let tamanho = (await handle.stat()).size;
    const chunkSize = 64 * 1024;
    let buffer = Buffer.alloc(0);
    let linhas: string[] = [];
    while (tamanho > 0 && linhas.length <= alvo) {
      const leitura = Math.min(chunkSize, tamanho);
      tamanho -= leitura;
      const chunk = Buffer.alloc(leitura);
      await handle.read(chunk, 0, leitura, tamanho);
      buffer = Buffer.concat([chunk, buffer]);
      linhas = buffer.toString("utf8").split("\n");
    }
    return linhas;
  } finally {
    await handle.close();
  }
}

/**
 * Le os ultimos registros (mais recente primeiro). Linhas invalidas sao
 * ignoradas silenciosamente; arquivo inexistente resulta em lista vazia.
 */
export async function lerUltimosJsonl<T>(
  filePath: string,
  limit: number,
  valida?: (valor: unknown) => valor is T
): Promise<T[]> {
  const n = Math.max(0, Math.trunc(limit));
  if (n === 0) return [];
  let linhas: string[];
  try {
    linhas = await lerUltimasLinhas(filePath, n);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const registros: T[] = [];
  for (const linha of linhas) {
    const texto = linha.trim();
    if (!texto) continue;
    try {
      const valor = JSON.parse(texto) as unknown;
      if (!valida || valida(valor)) registros.push(valor as T);
    } catch {
      // ignora linhas corrompidas
    }
  }
  return registros.slice(-n).reverse();
}

/** Esvazia o arquivo e remove a ultima rotacao. */
export async function limparJsonl(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, "", "utf8");
  await fs.promises.unlink(`${filePath}.1`).catch(() => {});
}
