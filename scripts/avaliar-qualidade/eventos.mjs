import { readFile } from "node:fs/promises";

/** Le o JSONL de eventos gravado pelo app, ignorando linhas corrompidas/incompletas. */
const ORIGENS_VALIDAS = ["objetos", "pose", "maos", "cena", "movimento"];

function origensValidas(origens) {
  if (!Array.isArray(origens)) return undefined;
  const filtradas = origens.filter((origem) => ORIGENS_VALIDAS.includes(origem));
  return filtradas.length ? filtradas : undefined;
}

/**
 * Le o JSONL de eventos gravado pelo app, ignorando linhas corrompidas/incompletas.
 *
 * Aceita tanto o stream legado (`timestamp`) quanto a memoria temporal
 * (`inicioEm`, `logs/eventos-temporais.jsonl`). O instante de comparacao e o
 * inicio do evento — nunca o instante em que o registro foi persistido.
 */
export function parsearEventos(texto) {
  const eventos = [];
  for (const linha of String(texto ?? "").split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const evt = JSON.parse(limpa);
      const instante = typeof evt?.timestamp === "string" ? evt.timestamp : evt?.inicioEm;
      if (typeof instante !== "string" || typeof evt?.tipo !== "string") continue;
      const origens = origensValidas(evt.origensSinal ?? evt.origens);
      eventos.push({
        tipo: evt.tipo,
        timestamp: instante,
        descricao: evt.descricao ?? "",
        ...(typeof evt.inicioEm === "string" ? { inicioEm: evt.inicioEm } : {}),
        ...(typeof evt.estado === "string" ? { estado: evt.estado } : {}),
        ...(typeof evt.statusEvidencia === "string"
          ? { statusEvidencia: evt.statusEvidencia }
          : {}),
        ...(typeof evt.naturezaInteracao === "string"
          ? { naturezaInteracao: evt.naturezaInteracao }
          : {}),
        ...(typeof evt.transicaoPosse === "string"
          ? { transicaoPosse: evt.transicaoPosse }
          : {}),
        ...(typeof evt.rotuloObjeto === "string" ? { rotuloObjeto: evt.rotuloObjeto } : {}),
        ...(origens ? { origensSinal: origens } : {}),
        ...(typeof evt.capturadoEmMs === "number" && Number.isFinite(evt.capturadoEmMs)
          ? { capturadoEmMs: evt.capturadoEmMs }
          : {}),
        ...(typeof evt.processadoEmMs === "number" && Number.isFinite(evt.processadoEmMs)
          ? { processadoEmMs: evt.processadoEmMs }
          : {}),
        ...(typeof evt.inferidoEmMs === "number" && Number.isFinite(evt.inferidoEmMs)
          ? { inferidoEmMs: evt.inferidoEmMs }
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
