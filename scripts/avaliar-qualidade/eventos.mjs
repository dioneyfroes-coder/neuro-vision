import { readFile } from "node:fs/promises";

/** Le o JSONL de eventos gravado pelo app, ignorando linhas corrompidas/incompletas. */
export function parsearEventos(texto) {
  const eventos = [];
  for (const linha of String(texto ?? "").split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const evt = JSON.parse(limpa);
      if (typeof evt?.timestamp !== "string" || typeof evt?.tipo !== "string") continue;
      eventos.push({
        tipo: evt.tipo,
        timestamp: evt.timestamp,
        descricao: evt.descricao ?? "",
        ...(typeof evt.rotuloObjeto === "string" ? { rotuloObjeto: evt.rotuloObjeto } : {}),
        ...(Array.isArray(evt.origensSinal)
          ? {
              origensSinal: evt.origensSinal.filter((origem) =>
                ["objetos", "pose", "maos", "cena", "movimento"].includes(origem)
              ),
            }
          : {}),
      });
    } catch {
      // linha corrompida: ignora
    }
  }
  return eventos;
}

export function tiposCompativeis(esperado, detectado) {
  return esperado === "qualquer" || esperado === detectado;
}

/**
 * Resolve a base (ms) para converter timestamps ISO em offsets `em`.
 *
 * Precedencia:
 *   1. `inicioSidecar`: um ISO gravado ao lado do JSONL de eventos (ex.: o
 *      instante em que o clipe comecou a tocar durante uma avaliacao com clipe
 *      real). Torna a medicao reprodutivel sem editar a anotacao a cada rodada.
 *   2. `inicio`: o campo `inicio` da anotacao.
 *   3. O timestamp detectado mais antigo.
 *   4. 0, quando nao ha nada.
 */
export function resolverBaseMs({ inicio, inicioSidecar, timestamps = [] } = {}) {
  if (inicioSidecar && Number.isFinite(Date.parse(inicioSidecar))) return Date.parse(inicioSidecar);
  if (inicio && Number.isFinite(Date.parse(inicio))) return Date.parse(inicio);
  const validos = timestamps.map((t) => Date.parse(t)).filter((n) => Number.isFinite(n));
  return validos.length ? Math.min(...validos) : 0;
}

export async function lerInicioSidecarEventos(caminhoEventos) {
  const candidatos = [
    `${caminhoEventos}.inicio`,
    caminhoEventos.replace(/\.jsonl$/i, ".inicio"),
  ];
  for (const candidato of new Set(candidatos)) {
    const texto = await readFile(candidato, "utf8").catch(() => undefined);
    if (texto !== undefined) return texto.trim();
  }
  return undefined;
}
