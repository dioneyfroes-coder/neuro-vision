/**
 * Contratos aditivos da telemetria de atenção (Fase 3).
 *
 * Nenhum campo interfere no gravador ou no ciclo principal: são registros
 * opcionais, com `sessaoId` para permitir filtro sem exigir sessão ativa na
 * leitura. `registradoEmMs` é informado pelo chamador, como no restante do
 * monitoramento.
 */
import type { CadenciaPercepcao } from "./cadencia";
import type { CustoEstadoAtencao } from "./custo-atencao";
import type {
  EstadoAtencao,
  MotivoTransicaoAtencao,
  ZonaAtencao,
} from "./seguranca-atencao";

export type TipoRegistroAtencao = "estado" | "custo" | "zonas" | "evidencia";

export interface QuadroEvidenciaRegistro {
  capturadoEmMs: number;
  fase: "pre" | "durante" | "pos";
}

export interface LacunaEvidenciaRegistro {
  inicioMs: number;
  fimMs: number;
}

export interface JanelaEvidenciaRegistro {
  eventoId: string;
  gatilhoEmMs: number;
  inicioMs: number;
  fimMs: number;
  congeladaEmMs?: number;
  quadros: QuadroEvidenciaRegistro[];
  lacunas: LacunaEvidenciaRegistro[];
  /** IDs de segmentos que realmente cobrem a janela (nunca inferidos). */
  segmentos: string[];
}

export interface RegistroAtencaoSeguranca {
  registroId: string;
  sessaoId: string;
  tipo: TipoRegistroAtencao;
  registradoEmMs: number;
  estado?: EstadoAtencao;
  motivo?: MotivoTransicaoAtencao;
  cadencia?: CadenciaPercepcao;
  custo?: CustoEstadoAtencao;
  zonas?: ZonaAtencao[];
  janela?: JanelaEvidenciaRegistro;
}
