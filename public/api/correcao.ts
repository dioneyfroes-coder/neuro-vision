import type { EventoTemporalPersistido } from "../../src/types";
import { ErroPercepcao } from "../../src/erros";

/** Campos que a interface permite corrigir; `null` devolve o campo à ausência. */
export interface PedidoCorrecaoEventoUi {
  descricao?: string | null;
  rotuloObjeto?: string | null;
  pessoaEntidadeId?: string | null;
  entidadeId?: string | null;
  naturezaInteracao?: string | null;
  transicaoPosse?: string | null;
  estadoAnterior?: string | null;
  estadoPosterior?: string | null;
  corrigidoPor: string;
  motivo: string;
}

export interface ResultadoCorrecao {
  ok: boolean;
  evento?: EventoTemporalPersistido;
  versao?: number;
  erro?: string;
}

export async function corrigirEventoTemporal(
  eventoId: string,
  pedido: PedidoCorrecaoEventoUi
): Promise<ResultadoCorrecao> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/eventos-temporais/${encodeURIComponent(eventoId)}/corrigir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pedido, eventoId }),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao corrigir evento", { cause: err });
  }
  return (await resposta.json()) as ResultadoCorrecao;
}
