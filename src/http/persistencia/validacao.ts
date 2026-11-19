import { limiteUploadSnapshot } from "../base";
import { normalizarMotivo } from "../validacao";
import { extrairBase64Imagem } from "./snapshots";

export function campoTipoTexto(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || typeof valor === "string") return null;
  return `campo '${campo}' deve ser texto`;
}

/** Valida o tamanho de um snapshot (data URL/base64) antes de gravar. */
export function validarSnapshot(
  imagem: unknown,
  maxBytes = limiteUploadSnapshot()
): string | null {
  if (imagem === undefined || imagem === null) return null;
  if (typeof imagem !== "string") return "campo 'snapshot' deve ser texto (data URL)";
  const b64 = extrairBase64Imagem(imagem);
  if (!b64) return null;
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > maxBytes) return `snapshot excede o limite de ${maxBytes} bytes`;
  return null;
}

/** Valida tipos do payload de `POST /api/log`. Retorna a mensagem de erro ou null. */
export function validarPayloadLog(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "payload deve ser um objeto JSON";
  }
  const p = payload as Record<string, unknown>;
  if (p.objetos !== undefined && !Array.isArray(p.objetos)) {
    return "campo 'objetos' deve ser uma lista";
  }
  if (p.nsfw !== undefined && !Array.isArray(p.nsfw)) {
    return "campo 'nsfw' deve ser uma lista";
  }
  const texto =
    campoTipoTexto(p.resumo, "resumo") ??
    campoTipoTexto(p.modelo, "modelo") ??
    campoTipoTexto(p.capturadoEm, "capturadoEm");
  if (texto) return texto;
  const erroFrameIds = validarListaFrameIds(p.frameIds);
  if (erroFrameIds) return erroFrameIds;
  return validarSnapshot(p.snapshot);
}

/** Valida uma lista de imagens (data URL/base64) para `POST /api/visao`. */
export function validarListaImagens(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) return "campo 'imagens' deve ser uma lista";
  if (valor.length === 0) return "campo 'imagens' nao pode ser vazio";
  for (let i = 0; i < valor.length; i += 1) {
    const item = valor[i];
    if (typeof item !== "string" || item.length === 0) {
      return `campo 'imagens[${i}]' deve ser texto (data URL)`;
    }
  }
  return null;
}

/** Valida os IDs de frames associados à inferência multimodal. */
export function validarListaFrameIds(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) return "campo 'frameIds' deve ser uma lista";
  if (valor.some((id) => typeof id !== "string" || id.length === 0)) {
    return "cada item de 'frameIds' deve ser texto não vazio";
  }
  return null;
}

/** Valida tipos do payload de `POST /api/visao`. Retorna a mensagem de erro ou null. */
export function validarPayloadVisao(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "payload deve ser um objeto JSON";
  }
  const p = payload as Record<string, unknown>;
  const texto =
    campoTipoTexto(p.imagem, "imagem") ??
    campoTipoTexto(p.modelo, "modelo") ??
    campoTipoTexto(p.anterior, "anterior") ??
    campoTipoTexto(p.roteiro, "roteiro") ??
    campoTipoTexto(p.prompt, "prompt") ??
    campoTipoTexto(p.capturadoEm, "capturadoEm") ??
    campoTipoTexto(p.contexto, "contexto");
  if (texto) return texto;
  const erroImagens = validarListaImagens(p.imagens);
  if (erroImagens) return erroImagens;
  const erroFrameIds = validarListaFrameIds(p.frameIds);
  if (erroFrameIds) return erroFrameIds;
  if (p.nsfw !== undefined && !Array.isArray(p.nsfw)) {
    return "campo 'nsfw' deve ser uma lista";
  }
  if (p.nsfwAtivo !== undefined && typeof p.nsfwAtivo !== "boolean") {
    return "campo 'nsfwAtivo' deve ser booleano";
  }
  if (p.motivo !== undefined && p.motivo !== null && !normalizarMotivo(p.motivo)) {
    return "campo 'motivo' tem valor invalido";
  }
  return validarSnapshot(p.snapshot);
}

/** Extrai a lista de imagens do payload (`imagens[]` ou `imagem` singular). */
export function extrairImagens(p: Record<string, unknown>): string[] {
  if (Array.isArray(p.imagens)) {
    return p.imagens.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return typeof p.imagem === "string" && p.imagem.length > 0 ? [p.imagem] : [];
}
