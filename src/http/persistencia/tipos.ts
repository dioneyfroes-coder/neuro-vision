import type { RegistroCiclo } from "../../domain/cycle";
import type {
  EstadoEventoTemporal,
  MotivoEncerramentoEvento,
  OrigemSinalTemporal,
  TipoEventoTemporal,
} from "../../domain/temporal-event";
import type { PoliticaSnapshots } from "../base";

export type SubsistemaIndisponivel = RegistroCiclo["subsistemasIndisponiveis"][number];

export const SUBSISTEMAS_VALIDOS: SubsistemaIndisponivel[] = ["deteccao", "pose", "maos", "nsfw"];

/**
 * Tipos que entram na memoria pesquisavel de gestos/posturas (P2.6). Ficam
 * fora de `eventos.jsonl` de proposito: o stream legado continua restrito a
 * fatos visuais (`aparicao`/`desaparecimento`/`mudanca_de_cena`).
 */
export const TIPOS_EVENTO_TEMPORAL_PERSISTIDOS: TipoEventoTemporal[] = [
  "gesto_detectado",
  "braco_levantado",
  "transicao_acao",
  "movimento_corporal",
  "pose_compativel_sexual",
  "interacao_objeto",
];

export const MOTIVOS_ENCERRAMENTO_TEMPORAL: MotivoEncerramentoEvento[] = [
  "sem_sinal",
  "troca_sinal",
  "periodo_cego",
  "oclusao",
  "transicao_concluida",
  "ponto",
];

export const ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS: EstadoEventoTemporal[] = [
  "provavel",
  "confirmado",
  "encerrado",
  "incerto",
];

export const ORIGENS_SINAL_TEMPORAL: OrigemSinalTemporal[] = [
  "objetos",
  "pose",
  "maos",
  "cena",
  "movimento",
];

export interface ArquivoSnapshot {
  nome: string;
  caminho: string;
  tamanho: number;
  mtimeMs: number;
  referenciado: boolean;
}

export interface OpcoesLimpezaSnapshots {
  snapDir?: string;
  logFiles?: string[];
  politica?: PoliticaSnapshots;
  agora?: number;
}

export interface ResultadoLimpezaSnapshots {
  removidos: number;
  mantidos: number;
  bytesLiberados: number;
  erros: string[];
}
