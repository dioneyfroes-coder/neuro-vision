import { descreverFrame } from "../api";
import type { EnviarMultimodal, RequisicaoMultimodal } from "./interpretador-ciclo";

/**
 * Transporte servidor: envia a requisicao ao backend Node (`/api/visao`) via
 * `descreverFrame`. Usa o texto bruto (`parcial`) quando possivel para preservar
 * JSON estruturado; cai para `evento.descricao` se o parcial estiver vazio.
 */
export function criarTransporteServidor(): EnviarMultimodal {
  return async (requisicao: RequisicaoMultimodal, sinal?: AbortSignal): Promise<{
    texto: string;
    modelo?: string;
    tokens?: number;
    duracaoMs?: number;
  }> => {
    const controle = sinal ?? new AbortController().signal;
    const { evento, parcial } = await descreverFrame(
      {
        imagens: requisicao.imagens,
        prompt: requisicao.prompt,
        modelo: requisicao.modelo,
        modo: "descricao",
      },
      controle
    );
    const texto = parcial && parcial.length > 0 ? parcial : (evento?.descricao ?? "");
    return {
      texto,
      modelo: evento?.modelo,
      tokens: evento?.tokens,
      duracaoMs: evento?.ms,
    };
  };
}
