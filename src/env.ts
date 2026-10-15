/**
 * Centraliza a leitura e os valores padrao das variaveis de ambiente da aplicacao.
 *
 * - Carrega, na primeira importacao, o arquivo `.env` da raiz do workspace
 *   (quando presente), sem sobrescrever variaveis ja definidas no processo.
 * - Expoe `env` com **getters** que leem `process.env` a cada acesso, entao
 *   alterar a variavel em tempo de execucao (ex.: nos testes) continua funcionando.
 * - Se o `.env` nao existir, valem os valores padrao declarados aqui.
 *
 * Nunca comite o `.env` (ja esta no `.gitignore`). Use `.env.example` como base.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "..");

function lerLinha(linha: string): { chave: string; valor: string } | null {
  const s = linha.replace(/#.*$/, "").trim();
  if (s.length === 0) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) return null;
  const idx = s.indexOf("=");
  const chave = s.slice(0, idx).trim();
  let valor = s.slice(idx + 1).trim();
  // Remove aspas simples/duplas ao redor do valor, se presentes
  if (
    (valor.startsWith('"') && valor.endsWith('"')) ||
    (valor.startsWith("'") && valor.endsWith("'"))
  ) {
    valor = valor.slice(1, -1);
  }
  return { chave, valor };
}

/** Le o `.env` da raiz e popula `process.env` apenas com o que ainda nao existe. */
export function carregarDotenv(caminho = path.join(WORKSPACE_ROOT, ".env")): void {
  if (!fs.existsSync(caminho)) return;
  try {
    const conteudo = fs.readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");
    for (const linha of conteudo.split("\n")) {
      const par = lerLinha(linha);
      if (!par) continue;
      // Prioridade para variaveis ja definidas no processo/shell.
      if (Object.prototype.hasOwnProperty.call(process.env, par.chave)) continue;
      process.env[par.chave] = par.valor;
    }
  } catch {
    // Falha de leitura nao deve derrubar a aplicacao; usa apenas o processo.
  }
}

carregarDotenv();

function str(nome: string, padrao: string): string {
  const v = process.env[nome];
  if (v === undefined || v === null || v === "") return padrao;
  return String(v);
}

function num(nome: string, padrao: number): number {
  const v = process.env[nome];
  if (v === undefined || v === null || v === "") return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

/** Como `num`, mas descarta valores negativos (voltam ao padrao). */
function numPos(nome: string, padrao: number): number {
  const n = num(nome, padrao);
  return n >= 0 ? n : padrao;
}

function bool(nome: string, padrao: boolean): boolean {
  const v = process.env[nome];
  if (v === undefined || v === null || v === "") return padrao;
  const l = v.toLowerCase().trim();
  if (l === "1" || l === "true" || l === "yes" || l === "on") return true;
  if (l === "0" || l === "false" || l === "no" || l === "off") return false;
  return padrao;
}

/**
 * Configuracao da aplicacao. Cada campo e um getter que le `process.env` na hora,
 * caindo no padrao quando a variavel nao esta definida ou esta vazia.
 */
export const env = {
  // Servidor HTTP
  get PORT(): number {
    return num("PORT", 3000);
  },
  get HOST(): string {
    return str("HOST", "127.0.0.1");
  },
  get NEURO_ALLOW_REMOTE(): boolean {
    return bool("NEURO_ALLOW_REMOTE", false);
  },
  get NEURO_ALLOWED_ORIGINS(): string {
    return str("NEURO_ALLOWED_ORIGINS", "");
  },

  // Backend de visao (LM Studio; ver `src/provedor.ts` e `src/visao.ts`)
  get NEURO_BASE_URL(): string {
    return str("NEURO_BASE_URL", "");
  },
  get NEURO_API_KEY(): string {
    return str("NEURO_API_KEY", "");
  },

  // Modelo de visao (o padrao final vive em `src/visao.ts`)
  get NEURO_MODEL(): string {
    return str("NEURO_MODEL", "");
  },

  // Traducao
  get NEURO_TRANSLATE_ENABLED(): boolean {
    return bool("NEURO_TRANSLATE_ENABLED", false);
  },
  get NEURO_TRANSLATE_MODEL(): string {
    return str("NEURO_TRANSLATE_MODEL", "");
  },

  // Imagens
  get NEURO_IMG_BASE64_CRU(): boolean {
    return bool("NEURO_IMG_BASE64_CRU", false);
  },

  // Limites e retencao
  get LOG_MAX_BYTES(): number {
    return num("LOG_MAX_BYTES", 5_000_000);
  },
  get SNAP_MAX_BYTES(): number {
    return numPos("SNAP_MAX_BYTES", 200_000_000);
  },
  get SNAP_MAX_FILES(): number {
    return numPos("SNAP_MAX_FILES", 1000);
  },
  get SNAP_MAX_AGE_DAYS(): number {
    return numPos("SNAP_MAX_AGE_DAYS", 30);
  },
  get SNAP_CLEAN_INTERVAL_MS(): number {
    return numPos("SNAP_CLEAN_INTERVAL_MS", 10 * 60 * 1000);
  },
  get SNAP_UPLOAD_MAX_BYTES(): number {
    return numPos("SNAP_UPLOAD_MAX_BYTES", 5_000_000);
  },
  get BODY_MAX_BYTES(): number {
    return numPos("BODY_MAX_BYTES", 1_000_000);
  },
  get VISAO_BODY_MAX_BYTES(): number {
    return numPos("VISAO_BODY_MAX_BYTES", 12_000_000);
  },

  // E2E
  get E2E_WEBCAM_CLIP(): string {
    return str("E2E_WEBCAM_CLIP", "");
  },
  get E2E_WEBCAM_CHANNEL(): string {
    return str("E2E_WEBCAM_CHANNEL", "");
  },
  get E2E_WEBCAM_DEBUG(): boolean {
    return bool("E2E_WEBCAM_DEBUG", false);
  },
  get E2E_WEBCAM_EVENTOS(): string {
    return str("E2E_WEBCAM_EVENTOS", "");
  },
};

export type Env = typeof env;
