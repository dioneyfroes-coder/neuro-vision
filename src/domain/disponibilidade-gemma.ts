/**
 * Disponibilidade e preparação do Gemma (Fase 5, plano §11).
 *
 * O backend multimodal é independente dos detectores locais: uma falha do
 * Gemma não pode ser confundida com "NSFW desligado" nem com falha de YOLO.
 * Este módulo é puro e determinístico — ele classifica uma resposta já obtida
 * de `/v1/models` e `/api/v0/models`; não faz fetch e não inventa status.
 */

export type StatusDisponibilidadeGemma =
  | "disponivel"
  | "indisponivel"
  | "nao_verificado";

export interface EntradaDisponibilidadeGemma {
  modelo: string;
  online?: boolean;
  /** Modelos instalados no backend (`/v1/models`). */
  modelos?: ReadonlyArray<string>;
  /** Modelos efetivamente em memória. */
  carregados?: ReadonlyArray<string>;
  /** Erro já capturado ao consultar o backend. */
  erro?: string;
}

export interface DiagnosticoDisponibilidadeGemma {
  status: StatusDisponibilidadeGemma;
  modelo: string;
  motivo: string;
  /** `true` quando o modelo está em memória e pronto para inferir. */
  pronto: boolean;
}

export const ETAPAS_WARMUP_GEMMA = [
  "consultar_modelos",
  "verificar_instalado",
  "forcar_carga",
  "verificar_memoria",
] as const;

export type EtapaWarmupGemma = (typeof ETAPAS_WARMUP_GEMMA)[number];

export interface PlanoWarmupGemma {
  modelo: string;
  etapas: readonly EtapaWarmupGemma[];
  /** Texto exibido antes de iniciar: diz o que será feito, não o que foi. */
  descricao: string;
}

function normalizar(nome: string): string {
  return nome.trim().toLowerCase();
}

/** Compara identidade de modelo sem depender de caixa/espaços. */
export function mesmoModeloGemma(a: string, b: string): boolean {
  const na = normalizar(a);
  const nb = normalizar(b);
  return na.length > 0 && na === nb;
}

function contem(nomes: ReadonlyArray<string> | undefined, modelo: string): boolean {
  return (nomes ?? []).some((nome) => mesmoModeloGemma(nome, modelo));
}

/**
 * Classifica a disponibilidade a partir de dados já coletados.
 *
 * - `nao_verificado`: backend não respondeu — não afirmar disponibilidade;
 * - `indisponivel`: backend online, mas o modelo não está instalado;
 * - `disponivel`: modelo instalado. `pronto` só é `true` com carga confirmada.
 */
export function avaliarDisponibilidadeGemma(
  entrada: EntradaDisponibilidadeGemma
): DiagnosticoDisponibilidadeGemma {
  const modelo = entrada.modelo.trim();
  if (entrada.online === false || (entrada.modelos ?? []).length === 0) {
    return {
      status: "nao_verificado",
      modelo,
      motivo:
        entrada.erro && entrada.erro.trim() !== ""
          ? `backend nao consultado: ${entrada.erro.trim()}`
          : "backend nao consultado",
      pronto: false,
    };
  }
  if (!contem(entrada.modelos, modelo)) {
    return {
      status: "indisponivel",
      modelo,
      motivo: "modelo nao instalado no backend; instale o identificador configurado antes de iniciar",
      pronto: false,
    };
  }
  const pronto = contem(entrada.carregados, modelo);
  return {
    status: "disponivel",
    modelo,
    motivo: pronto ? "modelo instalado e carregado" : "modelo instalado; carga pendente",
    pronto,
  };
}

/** Plano de warm-up controlado, executado pelo endpoint de preparação existente. */
export function planoWarmupGemma(modelo: string): PlanoWarmupGemma {
  const alvo = modelo.trim() || "(sem modelo)";
  return {
    modelo: alvo,
    etapas: ETAPAS_WARMUP_GEMMA,
    descricao:
      `Preparação do Gemma ${alvo}: consultar modelos, verificar instalação, ` +
      "forçar carga e confirmar memória. Independente da carga dos detectores locais.",
  };
}

/** Erro legível para a UI. Nunca transforma falha em sucesso silencioso. */
export function erroLegivelGemma(diagnostico: DiagnosticoDisponibilidadeGemma): string {
  if (diagnostico.status === "disponivel") return "";
  const prefixo =
    diagnostico.status === "indisponivel"
      ? `Gemma indisponível: ${diagnostico.modelo}`
      : `Gemma não verificado: ${diagnostico.modelo}`;
  return `${prefixo} — ${diagnostico.motivo}`;
}
