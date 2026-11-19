/** Configuração padrão do gerenciador (pode ser sobreposta por sessão). */
export interface ConfigGerenciadorGravacao {
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}

/** Dados necessários para abrir uma sessão de monitoramento. */
export interface OpcoesSessaoMonitoramento {
  /** Rótulo do ambiente (ex.: "sala", "garagem"). */
  ambiente: string;
  /** Instante de início em epoch ms. */
  agoraMs: number;
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}
