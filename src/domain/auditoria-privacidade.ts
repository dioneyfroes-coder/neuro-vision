/**
 * Auditoria determinística de arquivos versionados (Fase 6, plano §16).
 *
 * Classifica uma **lista de caminhos** — nunca lê conteúdo, não abre mídia e
 * não varre diretórios. Serve para responder "o que está entrando no repositório?"
 * de forma reproduzível. Um arquivo de texto pode conter segredos: a ausência
 * de caminhos sensíveis não é varredura de segredos, que segue em aberto.
 */

export type ClassificacaoArquivoNsfw =
  | "texto"
  | "midia"
  | "peso"
  | "log"
  | "segredo";

export interface RelatorioPrivacidadeNsfw {
  status: "limpo" | "atencao" | "sem_dados";
  motivo?: string;
  arquivos: number;
  porClasse: Record<ClassificacaoArquivoNsfw, number>;
  caminhosSensiveis: string[];
  /** Nomes suspeitos exigem conferência humana; o caminho sozinho não prova vazamento. */
  revisaoHumanaNecessaria: boolean;
}

const EXTENSOES_MIDIA = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "heic",
  "mp4", "webm", "mov", "avi", "mkv", "m4v", "mp3", "wav", "ogg", "m4a", "flac",
]);

const EXTENSOES_PESO = new Set([
  "onnx", "bin", "safetensors", "pt", "pth", "ckpt", "tflite", "gguf", "ggml", "wasm",
]);

function vazio(motivo: string): RelatorioPrivacidadeNsfw {
  return {
    status: "sem_dados",
    motivo,
    arquivos: 0,
    porClasse: { texto: 0, midia: 0, peso: 0, log: 0, segredo: 0 },
    caminhosSensiveis: [],
    revisaoHumanaNecessaria: false,
  };
}

export function normalizarCaminhoArquivo(caminho: string): string {
  return caminho.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function classificarArquivoNsfw(caminho: string): ClassificacaoArquivoNsfw {
  const normalizado = normalizarCaminhoArquivo(caminho);
  if (normalizado === "") return "texto";
  const partes = normalizado.split("/");
  const nome = partes[partes.length - 1];
  const extensao = nome.includes(".") ? nome.split(".").pop()?.toLowerCase() ?? "" : "";
  const minuto = nome.toLowerCase();

  // Modelos de configuração são versionados de propósito e não contêm valores.
  const modeloEnv = [".env.example", ".env.sample", ".env.template"].includes(minuto);
  if (
    ((minuto === ".env" || minuto.startsWith(".env.")) && !modeloEnv) ||
    minuto.includes("credential") ||
    minuto.includes("senha") ||
    minuto.includes("password") ||
    /(^|[._-])(token|secret|chave|key|pem)([._-]|$)/.test(minuto) ||
    ["key", "pem", "pfx", "p12", "asc"].includes(extensao)
  ) {
    return "segredo";
  }
  if (EXTENSOES_MIDIA.has(extensao)) return "midia";
  if (EXTENSOES_PESO.has(extensao)) return "peso";
  if ((partes.includes("logs") && nome !== ".gitkeep") || extensao === "log") return "log";
  return "texto";
}

export function auditarArquivosVersionados(caminhos: ReadonlyArray<string>): RelatorioPrivacidadeNsfw {
  const lista = caminhos.filter((caminho) => typeof caminho === "string" && caminho.trim() !== "");
  if (lista.length === 0) return vazio("lista de arquivos vazia");

  const porClasse: Record<ClassificacaoArquivoNsfw, number> = {
    texto: 0,
    midia: 0,
    peso: 0,
    log: 0,
    segredo: 0,
  };
  const sensiveis: string[] = [];
  for (const caminho of lista) {
    const classe = classificarArquivoNsfw(caminho);
    porClasse[classe] += 1;
    if (classe !== "texto") sensiveis.push(normalizarCaminhoArquivo(caminho));
  }
  sensiveis.sort();

  return {
    status: sensiveis.length === 0 ? "limpo" : "atencao",
    arquivos: lista.length,
    porClasse,
    caminhosSensiveis: sensiveis,
    revisaoHumanaNecessaria: sensiveis.length > 0,
  };
}
