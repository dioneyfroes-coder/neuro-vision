/**
 * Medição de latência e custo por interpretação/evento (Fase 6, item 7).
 *
 * Telemetria estritamente aditiva: só registra o que foi medido. Sem tabela de
 * preços explícita não há custo monetário — o campo fica ausente e o motivo é
 * registrado. Valores nunca são zero ou estimativa inventada quando a medição
 * não existe. O relógio é injetado pelo chamador.
 */
export interface TabelaPrecosMultimodal {
  entradaPorMilhao: number;
  saidaPorMilhao: number;
  moeda: string;
}

export interface EntradaCustoMultimodal {
  cycleId: string;
  /** Eventos que motivaram a chamada (decisão orientada a eventos). */
  eventoIds?: readonly string[];
  modelo?: string;
  duracaoMs?: number;
  latenciaAteRespostaMs?: number;
  /** Total de tokens quando o backend não separa entrada/saída. */
  tokens?: number;
  tokensEntrada?: number;
  tokensSaida?: number;
  precos?: TabelaPrecosMultimodal;
  versaoPrompt?: string;
  registradoEm: string;
}

export interface RegistroCustoMultimodal {
  cycleId: string;
  eventoIds: string[];
  modelo?: string;
  duracaoMs?: number;
  latenciaAteRespostaMs?: number;
  tokensEntrada?: number;
  tokensSaida?: number;
  custoEstimado?: number;
  moeda?: string;
  motivoCustoIndisponivel?: string;
  versaoPrompt?: string;
  registradoEm: string;
}

function inteiroOuAusente(valor: number | undefined): number | undefined {
  return Number.isFinite(valor) && (valor as number) >= 0 ? Math.round(valor as number) : undefined;
}

/** Monta o registro de custo sem inferir valores não medidos. */
export function medirCustoMultimodal(entrada: EntradaCustoMultimodal): RegistroCustoMultimodal {
  const registro: RegistroCustoMultimodal = {
    cycleId: entrada.cycleId,
    eventoIds: [...(entrada.eventoIds ?? [])],
    registradoEm: entrada.registradoEm,
  };
  const modelo = entrada.modelo?.trim();
  if (modelo) registro.modelo = modelo;
  const duracaoMs = inteiroOuAusente(entrada.duracaoMs);
  if (duracaoMs !== undefined) registro.duracaoMs = duracaoMs;
  const latencia = inteiroOuAusente(entrada.latenciaAteRespostaMs);
  if (latencia !== undefined) registro.latenciaAteRespostaMs = latencia;
  const versaoPrompt = entrada.versaoPrompt?.trim();
  if (versaoPrompt) registro.versaoPrompt = versaoPrompt;

  const entradaTokens = inteiroOuAusente(entrada.tokensEntrada);
  const saidaTokens = inteiroOuAusente(entrada.tokensSaida);
  if (entradaTokens !== undefined) registro.tokensEntrada = entradaTokens;
  if (saidaTokens !== undefined) registro.tokensSaida = saidaTokens;

  if (!entrada.precos) {
    registro.motivoCustoIndisponivel = "tabela_precos_ausente";
    return registro;
  }
  if (entradaTokens === undefined || saidaTokens === undefined) {
    // Um total de tokens não permite separar preços de entrada e saída.
    registro.motivoCustoIndisponivel =
      entrada.tokens !== undefined ? "sem_divisao_entrada_saida" : "tokens_nao_medidos";
    return registro;
  }
  const { entradaPorMilhao, saidaPorMilhao, moeda } = entrada.precos;
  if (
    !Number.isFinite(entradaPorMilhao) ||
    !Number.isFinite(saidaPorMilhao) ||
    entradaPorMilhao < 0 ||
    saidaPorMilhao < 0
  ) {
    registro.motivoCustoIndisponivel = "tabela_precos_invalida";
    return registro;
  }
  registro.custoEstimado =
    (entradaTokens / 1_000_000) * entradaPorMilhao +
    (saidaTokens / 1_000_000) * saidaPorMilhao;
  registro.moeda = moeda;
  return registro;
}
