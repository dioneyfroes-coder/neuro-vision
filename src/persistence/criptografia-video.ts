/**
 * Criptografia em repouso dos bytes de vídeo (Fase 7, plano §10).
 *
 * AES-256-GCM com chave de 32 bytes **fornecida pelo operador** (variável de
 * ambiente ou arquivo fora do repositório). O formato é aditivo e marcado no
 * metadado do segmento: `NVG1 | iv(12) | tag(16) | ciphertext`. Sem chave, o
 * armazenador continua gravando em claro e o metadado diz `cifrado: null` —
 * nunca uma afirmação implícita de proteção.
 */
import crypto from "node:crypto";

export const IDENTIFICADOR_CIFRAGEM = "aes-256-gcm:v1";
const MAGIC = Buffer.from("NVG1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHAVE_BYTES = 32;

export type MotivoErroCifragem = "chave_invalida" | "formato_invalido" | "autenticacao_falhou";

export class ErroCifragemVideo extends Error {
  constructor(
    readonly motivo: MotivoErroCifragem,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ErroCifragemVideo";
  }
}

export interface CifradorVideo {
  readonly id: typeof IDENTIFICADOR_CIFRAGEM;
  cifrar(bytes: Buffer): Buffer;
  decifrar(bytes: Buffer): Buffer;
}

export function chaveValida(chave: Buffer | undefined): chave is Buffer {
  return Buffer.isBuffer(chave) && chave.length === CHAVE_BYTES;
}

export function criarCifradorVideo(chave: Buffer | undefined): CifradorVideo | undefined {
  if (!chaveValida(chave)) {
    if (chave === undefined) return undefined;
    throw new ErroCifragemVideo("chave_invalida", "A chave de video deve ter 32 bytes");
  }
  return {
    id: IDENTIFICADOR_CIFRAGEM,
    cifrar(bytes: Buffer): Buffer {
      const iv = crypto.randomBytes(IV_BYTES);
      const cifro = crypto.createCipheriv("aes-256-gcm", chave, iv);
      cifro.setAAD(MAGIC);
      const ciphertext = Buffer.concat([cifro.update(bytes), cifro.final()]);
      return Buffer.concat([MAGIC, iv, cifro.getAuthTag(), ciphertext]);
    },
    decifrar(bytes: Buffer): Buffer {
      const cabeçalho = bytes.subarray(0, MAGIC.length);
      if (!cabeçalho.equals(MAGIC) || bytes.length < MAGIC.length + IV_BYTES + TAG_BYTES) {
        throw new ErroCifragemVideo("formato_invalido", "Bytes de video nao estao no formato cifrado");
      }
      let offset = MAGIC.length;
      const iv = bytes.subarray(offset, offset + IV_BYTES);
      offset += IV_BYTES;
      const tag = bytes.subarray(offset, offset + TAG_BYTES);
      offset += TAG_BYTES;
      try {
        const decifro = crypto.createDecipheriv("aes-256-gcm", chave, iv);
        decifro.setAAD(MAGIC);
        decifro.setAuthTag(tag);
        return Buffer.concat([decifro.update(bytes.subarray(offset)), decifro.final()]);
      } catch {
        throw new ErroCifragemVideo(
          "autenticacao_falhou",
          "Nao foi possivel autenticar os bytes cifrados do video"
        );
      }
    },
  };
}

/**
 * Interpreta uma chave base64 (padrão) ou hexadecimal (64 caracteres).
 * Nunca registra o valor em log; erros citam apenas o formato esperado.
 */
export function interpretarChaveVideo(valor: string | undefined): Buffer | undefined {
  if (valor === undefined || valor.trim() === "") return undefined;
  const texto = valor.trim();
  let chave: Buffer;
  try {
    chave = /^[0-9a-fA-F]{64}$/.test(texto) ? Buffer.from(texto, "hex") : Buffer.from(texto, "base64");
  } catch {
    throw new ErroCifragemVideo("chave_invalida", "Chave de video invalida");
  }
  if (!chaveValida(chave)) {
    throw new ErroCifragemVideo("chave_invalida", "A chave de video deve ter 32 bytes");
  }
  return chave;
}
