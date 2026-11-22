/**
 * Serviço da telemetria de atenção (Fase 3).
 *
 * Append-only em JSONL, como o inventário. A validação do payload acontece na
 * camada HTTP; aqui a regra é apenas persistir e filtrar por sessão sem ler
 * relógio nem tocar no gravador de vídeo.
 */
import { appendJsonl, lerUltimosJsonl } from "../persistence/armazenamento-jsonl";
import type { RegistroAtencaoSeguranca } from "../domain/telemetria-atencao";

export const LIMITE_REGISTROS_ATENCAO_PADRAO = 500;

export interface OpcoesServicoAtencao {
  arquivo: string;
  maxBytes: number;
}

export class ServicoAtencao {
  constructor(private readonly opcoes: OpcoesServicoAtencao) {}

  registrar(registro: RegistroAtencaoSeguranca): Promise<void> {
    return appendJsonl(registro, this.opcoes.arquivo, this.opcoes.maxBytes);
  }

  async listar(
    sessaoId?: string,
    limit = LIMITE_REGISTROS_ATENCAO_PADRAO
  ): Promise<RegistroAtencaoSeguranca[]> {
    const registros = await lerUltimosJsonl<RegistroAtencaoSeguranca>(
      this.opcoes.arquivo,
      limit
    );
    return sessaoId === undefined
      ? registros
      : registros.filter((registro) => registro.sessaoId === sessaoId);
  }
}
