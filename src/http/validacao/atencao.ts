/**
 * Validação do payload opcional de telemetria de atenção (Fase 3).
 *
 * O retorno é o registro normalizado ou uma mensagem de erro. Nenhum campo é
 * inferido a partir de ausência: se o cliente não mediu algo, o campo simples-
 * mente não aparece no registro persistido.
 */
import { uuid, type CadenciaPercepcao, type CustoEstadoAtencao, type JanelaEvidenciaRegistro, type RegistroAtencaoSeguranca, type TipoRegistroAtencao, type ZonaAtencao } from "../../domain";
import { ESTADOS_ATENCAO, MOTIVOS_TRANSICAO_ATENCAO } from "../../domain/seguranca-atencao";

const TIPOS: readonly TipoRegistroAtencao[] = ["estado", "custo", "zonas", "evidencia"];

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.length > 0 ? valor : undefined;
}

function cadencia(valor: unknown): CadenciaPercepcao | string | undefined {
  if (valor === undefined) return undefined;
  const p = objeto(valor);
  if (!p) return "cadencia deve ser um objeto";
  const resultado: CadenciaPercepcao = {};
  for (const chave of ["deteccaoMs", "poseMs", "maosMs", "nsfwMs"] as const) {
    const medido = numero(p[chave]);
    if (medido !== undefined) {
      if (medido < 0) return `cadencia.${chave} nao pode ser negativo`;
      resultado[chave] = medido;
    }
  }
  return resultado;
}

function zonas(valor: unknown): ZonaAtencao[] | string | undefined {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor)) return "zonas deve ser uma lista";
  const resultado: ZonaAtencao[] = [];
  for (const item of valor) {
    const p = objeto(item);
    const zonaId = texto(p?.zonaId);
    const tipo = p?.tipo === "entrada" || p?.tipo === "saida" ? p.tipo : undefined;
    const caixa = objeto(p?.caixa);
    if (!p || !zonaId || !tipo || !caixa) return "zona exige zonaId, tipo e caixa";
    const coords = ["xmin", "ymin", "xmax", "ymax"].map((chave) => numero(caixa[chave]));
    if (coords.some((coord) => coord === undefined)) return `zona ${zonaId} tem coordenada invalida`;
    const [xmin, ymin, xmax, ymax] = coords as number[];
    if ([xmin, ymin, xmax, ymax].some((coord) => coord < 0 || coord > 1)) {
      return `zona ${zonaId} deve usar coordenadas entre 0 e 1`;
    }
    if (xmin > xmax || ymin > ymax) return `zona ${zonaId} tem extremos invertidos`;
    resultado.push({ zonaId, tipo, caixa: { xmin, ymin, xmax, ymax } });
  }
  return resultado;
}

function janela(valor: unknown): JanelaEvidenciaRegistro | string | undefined {
  if (valor === undefined) return undefined;
  const p = objeto(valor);
  if (!p) return "janela deve ser um objeto";
  const eventoId = texto(p.eventoId);
  const gatilhoEmMs = numero(p.gatilhoEmMs);
  const inicioMs = numero(p.inicioMs);
  const fimMs = numero(p.fimMs);
  if (!eventoId || gatilhoEmMs === undefined || inicioMs === undefined || fimMs === undefined) {
    return "janela exige eventoId, gatilhoEmMs, inicioMs e fimMs";
  }
  if (inicioMs > gatilhoEmMs || gatilhoEmMs > fimMs) return "janela tem extremos invertidos";
  const quadros: JanelaEvidenciaRegistro["quadros"] = [];
  if (Array.isArray(p.quadros)) {
    for (const item of p.quadros) {
      const q = objeto(item);
      const capturadoEmMs = numero(q?.capturadoEmMs);
      const fase = q?.fase;
      if (capturadoEmMs === undefined || (fase !== "pre" && fase !== "durante" && fase !== "pos")) {
        return "quadro da janela exige capturadoEmMs e fase validos";
      }
      quadros.push({ capturadoEmMs, fase });
    }
  }
  const lacunas: JanelaEvidenciaRegistro["lacunas"] = [];
  if (Array.isArray(p.lacunas)) {
    for (const item of p.lacunas) {
      const l = objeto(item);
      const inicio = numero(l?.inicioMs);
      const fim = numero(l?.fimMs);
      if (inicio === undefined || fim === undefined || inicio > fim) {
        return "lacuna da janela exige inicioMs e fimMs validos";
      }
      lacunas.push({ inicioMs: inicio, fimMs: fim });
    }
  }
  const segmentos = Array.isArray(p.segmentos)
    ? p.segmentos.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const congeladaEmMs = numero(p.congeladaEmMs);
  return {
    eventoId,
    gatilhoEmMs,
    inicioMs,
    fimMs,
    quadros,
    lacunas,
    segmentos,
    ...(congeladaEmMs === undefined ? {} : { congeladaEmMs }),
  };
}

/** Normaliza um registro, ou devolve o motivo da recusa. */
export function montarRegistroAtencao(payload: unknown): RegistroAtencaoSeguranca | string {
  const p = objeto(payload);
  if (!p) return "payload deve ser um objeto";
  const sessaoId = texto(p.sessaoId);
  if (!sessaoId) return "campo 'sessaoId' e obrigatorio";
  const tipo = TIPOS.find((candidate) => candidate === p.tipo);
  if (!tipo) return "campo 'tipo' deve ser estado, custo, zonas ou evidencia";
  const registradoEmMs = numero(p.registradoEmMs);
  if (registradoEmMs === undefined) return "campo 'registradoEmMs' deve ser finito";

  const estado = typeof p.estado === "string" && (ESTADOS_ATENCAO as readonly string[]).includes(p.estado)
    ? (p.estado as RegistroAtencaoSeguranca["estado"])
    : undefined;
  if (p.estado !== undefined && !estado) return "campo 'estado' desconhecido";
  const motivo =
    typeof p.motivo === "string" && (MOTIVOS_TRANSICAO_ATENCAO as readonly string[]).includes(p.motivo)
      ? (p.motivo as RegistroAtencaoSeguranca["motivo"])
      : undefined;
  if (p.motivo !== undefined && !motivo) return "campo 'motivo' desconhecido";

  const cadenciaNormalizada = cadencia(p.cadencia);
  if (typeof cadenciaNormalizada === "string") return cadenciaNormalizada;
  const zonasNormalizadas = zonas(p.zonas);
  if (typeof zonasNormalizadas === "string") return zonasNormalizadas;
  const janelaNormalizada = janela(p.janela);
  if (typeof janelaNormalizada === "string") return janelaNormalizada;

  const custoNormalizado = p.custo === undefined ? undefined : objeto(p.custo);
  if (p.custo !== undefined && !custoNormalizado) return "campo 'custo' deve ser um objeto";

  return {
    registroId: texto(p.registroId) ?? uuid(),
    sessaoId,
    tipo,
    registradoEmMs,
    ...(estado ? { estado } : {}),
    ...(motivo ? { motivo } : {}),
    ...(cadenciaNormalizada ? { cadencia: cadenciaNormalizada } : {}),
    ...(custoNormalizado ? { custo: custoNormalizado as unknown as CustoEstadoAtencao } : {}),
    ...(zonasNormalizadas ? { zonas: zonasNormalizadas } : {}),
    ...(janelaNormalizada ? { janela: janelaNormalizada } : {}),
  };
}
