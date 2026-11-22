/**
 * Confirmação de mudanças de cena (Fase 2).
 *
 * Uma detecção isolada registra uma hipótese; repetições independentes da
 * mesma mudança acumulam evidência. A promoção a `observado` só acontece para
 * mudanças apoiadas em detecção direta — ausência informada continua sendo
 * hipótese, por mais vezes que apareça.
 */
import type { MudancaCena } from "./tipos";

/** Número de observações independentes para confirmar uma mudança. */
export const CONFIRMACOES_MINIMAS_PADRAO = 2;

export type DecisaoRevisaoMudanca = "confirmada" | "rejeitada";

/**
 * Acrescenta uma observação à mudança. Devolve o objeto original quando a
 * revisão manual já a rejeitou, para que uma decisão humana não seja atropelada
 * pela repetição automática.
 */
export function registrarConfirmacaoMudanca(
  mudanca: MudancaCena,
  agoraMs: number,
  minimo = CONFIRMACOES_MINIMAS_PADRAO
): MudancaCena {
  // Decisão manual já tomada ou limite atingido: novas repetições não podem
  // virar um registro novo a cada observação.
  if (mudanca.revisao === "rejeitada" || mudanca.revisao === "confirmada") return mudanca;
  const limite = Number.isFinite(minimo) && minimo >= 1 ? Math.trunc(minimo) : 1;
  const confirmacoes = (mudanca.confirmacoes ?? 0) + 1;
  if (confirmacoes < limite) return { ...mudanca, confirmacoes };

  const promover = mudanca.observado && mudanca.statusEvidencia === "possivel";
  return {
    ...mudanca,
    confirmacoes,
    confirmadoEmMs: mudanca.confirmadoEmMs ?? agoraMs,
    revisao: "confirmada",
    ...(promover
      ? {
          statusEvidencia: "observado" as const,
          confianca: Math.min(1, Math.max(mudanca.confianca, 0.61)),
        }
      : {}),
  };
}

/** Decisão manual da interface de revisão. */
export function revisarMudanca(
  mudanca: MudancaCena,
  decisao: DecisaoRevisaoMudanca,
  agoraMs: number
): MudancaCena {
  return {
    ...mudanca,
    revisao: decisao,
    ...(decisao === "confirmada"
      ? { confirmadoEmMs: mudanca.confirmadoEmMs ?? agoraMs }
      : {}),
  };
}
