/**
 * Regras puras para o histórico de ações observáveis (Fase 4).
 *
 * Nenhuma função aqui lê relógio, arquivo, rede ou modelo. Elas apenas dão
 * nome ao que já foi medido por outro subsistema. Ausência de medição continua
 * ausente: nenhuma regra transforma falha, oclusão ou `naoAmostrado` em
 * "não houve interação" — nem inventa pego/deixado sem evidência.
 */
import type { MudancaCena } from "./cena";

/** Natureza da interação, derivada apenas de sinais já observados. */
export type NaturezaInteracao = "proximidade" | "contato" | "manipulacao";

/** Transição de posse com suporte observacional explícito. */
export type TransicaoPosse = "pego" | "deixado";

export interface SinalNaturezaInteracao {
  grau: "incerto" | "provavel" | "confirmado";
  framesSobreposicao: number;
  objetoMoveu: boolean;
}

/**
 * `proximidade` é a forma mais fraca (inclusive o estado `incerto`); `contato`
 * exige sobreposição sustentada; `manipulacao` exige o grau `confirmado`, que
 * já carrega sobreposição + deslocamento + continuidade válidas.
 */
export function naturezaInteracao(
  sinal: SinalNaturezaInteracao,
  framesParaContato: number
): NaturezaInteracao {
  if (sinal.grau === "confirmado" && sinal.objetoMoveu) return "manipulacao";
  if (sinal.framesSobreposicao >= framesParaContato) return "contato";
  return "proximidade";
}

export interface SinalTransicaoPosse {
  grau: "incerto" | "provavel" | "confirmado" | "encerrado";
  grauMaximo: "incerto" | "provavel" | "confirmado";
  motivoEncerramento?: string;
  continuidadeValida: boolean;
  framesObjetoEstavel: number;
  /** Evita rotular cada reatualização `confirmado` como um novo "pego". */
  primeiroConfirmado?: boolean;
}

/**
 * `pego` só no primeiro `confirmado` com continuidade válida. `deixado` só no
 * encerramento por afastamento da mão (`sem_sinal`), depois que o mesmo objeto
 * foi visto em posição estável por `framesParaEncerrar` quadros. Oclusão,
 * período cego e falha de inferência **nunca** viram "deixado".
 */
export function transicaoPosse(
  sinal: SinalTransicaoPosse,
  framesParaEncerrar: number
): TransicaoPosse | undefined {
  if (
    sinal.grau === "confirmado" &&
    sinal.continuidadeValida &&
    sinal.primeiroConfirmado !== false
  ) {
    return "pego";
  }
  if (
    sinal.grau !== "encerrado" ||
    sinal.motivoEncerramento !== "sem_sinal" ||
    sinal.grauMaximo !== "confirmado" ||
    !sinal.continuidadeValida ||
    sinal.framesObjetoEstavel < framesParaEncerrar
  ) {
    return undefined;
  }
  return "deixado";
}

/**
 * Ponte para o par estado anterior/posterior que já vive em `MudancaCena`.
 * Não cria um segundo formato: apenas o expõe quando o estado foi de fato
 * observado. Hipótese, oclusão e falha não viram estado físico.
 */
export function estadosDeMudancaCena(
  mudanca: Pick<
    MudancaCena,
    "tipo" | "observado" | "statusEvidencia" | "estadoAnterior" | "estadoAtual"
  >
): { estadoAnterior?: string; estadoPosterior?: string } {
  if (mudanca.tipo !== "estado_alterado" || !mudanca.observado) return {};
  if (
    mudanca.statusEvidencia === "possivel" ||
    mudanca.statusEvidencia === "nao_observado" ||
    mudanca.statusEvidencia === "falha_percepcao" ||
    mudanca.statusEvidencia === "ocluido"
  ) {
    return {};
  }
  const anterior =
    typeof mudanca.estadoAnterior === "string" && mudanca.estadoAnterior.trim()
      ? mudanca.estadoAnterior
      : undefined;
  const posterior =
    typeof mudanca.estadoAtual === "string" && mudanca.estadoAtual.trim()
      ? mudanca.estadoAtual
      : undefined;
  return {
    ...(anterior ? { estadoAnterior: anterior } : {}),
    ...(posterior ? { estadoPosterior: posterior } : {}),
  };
}

/**
 * Liga um evento de ação ao par estado anterior/posterior observado pelo
 * inventário. A associacao so é feita quando o objeto é explicitamente o mesmo
 * (`objetoId` == `entidadeId`) e a mudanca cai na janela do evento. Sem essa
 * correspondencia o evento segue sem estado físico — nunca se infere estado a
 * partir de rotulo parecido ou de ausencia.
 */
export function estadosObservadosParaEvento(
  evento: {
    sessionId: string;
    entidadeId?: string;
    inicioEm: string;
    fimEm?: string;
  },
  mudancas: readonly Pick<
    MudancaCena,
    | "sessaoId"
    | "objetoId"
    | "tipo"
    | "observado"
    | "statusEvidencia"
    | "estadoAnterior"
    | "estadoAtual"
    | "detectadoEmMs"
  >[]
): { estadoAnterior?: string; estadoPosterior?: string } {
  if (!evento.entidadeId) return {};
  const inicio = Date.parse(evento.inicioEm);
  const fim = evento.fimEm ? Date.parse(evento.fimEm) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(inicio)) return {};
  const candidata = mudancas.find((mudanca) => {
    if (mudanca.sessaoId !== evento.sessionId || mudanca.objetoId !== evento.entidadeId) {
      return false;
    }
    return (
      Number.isFinite(mudanca.detectadoEmMs) &&
      mudanca.detectadoEmMs >= inicio - 2000 &&
      mudanca.detectadoEmMs <= (Number.isFinite(fim) ? fim : inicio + 60_000) + 2000
    );
  });
  return candidata ? estadosDeMudancaCena(candidata) : {};
}
