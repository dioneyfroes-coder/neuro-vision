import type {
  MotivoRejeicaoQuadro,
  QuadroAtribuido,
  QuadroGravado,
  SessaoMonitoramento,
  VideoSegment,
} from "../../src/domain/monitoramento";
import type { RegistroAtencaoSeguranca } from "../../src/domain/telemetria-atencao";
import { ErroPercepcao } from "../../src/erros";
import { exigirRespostaOk } from "./http";

export interface OpcoesIniciarMonitoramento {
  ambiente: string;
  agoraMs?: number;
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}

export interface RejeicaoQuadroMonitoramento {
  frameId: string;
  motivo: MotivoRejeicaoQuadro;
  erro: string;
}

export interface ResultadoQuadrosMonitoramento {
  sessao: SessaoMonitoramento | null;
  atribuicoes: QuadroAtribuido[];
  rejeitados: RejeicaoQuadroMonitoramento[];
}

export function urlSessaoMonitoramento(sessaoId: string): string {
  return `/api/monitoramento/sessoes/${encodeURIComponent(sessaoId)}`;
}

export async function postMonitoramento<T>(url: string, corpo: unknown, msgPadrao: string): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo ?? {}),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", msgPadrao, { cause: err });
  }
  await exigirRespostaOk(resposta, msgPadrao);
  return (await resposta.json()) as T;
}

export async function iniciarMonitoramento(
  opcoes: OpcoesIniciarMonitoramento
): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    "/api/monitoramento/sessoes",
    opcoes,
    "Falha ao iniciar o monitoramento"
  );
  return dados.sessao;
}

export async function enviarQuadrosMonitoramento(
  quadros: QuadroGravado[]
): Promise<ResultadoQuadrosMonitoramento> {
  const dados = await postMonitoramento<ResultadoQuadrosMonitoramento>(
    "/api/monitoramento/quadros",
    { quadros },
    "Falha ao registrar quadros do monitoramento"
  );
  return {
    sessao: dados.sessao ?? null,
    atribuicoes: dados.atribuicoes ?? [],
    rejeitados: dados.rejeitados ?? [],
  };
}

export async function pausarMonitoramento(sessaoId: string): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    `${urlSessaoMonitoramento(sessaoId)}/pausar`,
    {},
    "Falha ao pausar o monitoramento"
  );
  return dados.sessao;
}

export async function retomarMonitoramento(sessaoId: string): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    `${urlSessaoMonitoramento(sessaoId)}/retomar`,
    {},
    "Falha ao retomar o monitoramento"
  );
  return dados.sessao;
}

export async function encerrarMonitoramento(
  sessaoId: string,
  agoraMs?: number
): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    `${urlSessaoMonitoramento(sessaoId)}/encerrar`,
    agoraMs === undefined ? {} : { agoraMs },
    "Falha ao encerrar o monitoramento"
  );
  return dados.sessao;
}

export async function interromperMonitoramento(
  sessaoId: string,
  agoraMs?: number,
  motivo: "falha" | "sem_quadros" = "falha"
): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    `${urlSessaoMonitoramento(sessaoId)}/interromper`,
    { ...(agoraMs === undefined ? {} : { agoraMs }), motivo },
    "Falha ao interromper o monitoramento"
  );
  return dados.sessao;
}

export async function listarSessoesMonitoramento(limite = 100): Promise<SessaoMonitoramento[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/sessoes?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler as sessoes de monitoramento", {
      cause: err,
    });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { sessoes?: SessaoMonitoramento[] };
  return dados.sessoes ?? [];
}

export async function listarSegmentosDaSessao(
  sessaoId: string,
  limite = 2000
): Promise<VideoSegment[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`${urlSessaoMonitoramento(sessaoId)}/segmentos?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler os segmentos da sessao", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { segmentos?: VideoSegment[] };
  return dados.segmentos ?? [];
}

export async function listarSegmentosMonitoramento(opcoes: {
  inicio?: number;
  fim?: number;
  limite?: number;
} = {}): Promise<VideoSegment[]> {
  const params = new URLSearchParams({ limit: String(opcoes.limite ?? 2000) });
  if (opcoes.inicio !== undefined) params.set("inicio", String(opcoes.inicio));
  if (opcoes.fim !== undefined) params.set("fim", String(opcoes.fim));
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/segmentos?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler os segmentos de monitoramento", {
      cause: err,
    });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { segmentos?: VideoSegment[] };
  return dados.segmentos ?? [];
}

/** Grava telemetria opcional de atenção; falha nunca interrompe a gravação. */
export async function gravarAtencaoSeguranca(
  registro: Omit<RegistroAtencaoSeguranca, "registroId"> & { registroId?: string }
): Promise<RegistroAtencaoSeguranca> {
  const dados = await postMonitoramento<{ registro: RegistroAtencaoSeguranca }>(
    "/api/monitoramento/seguranca/atencao",
    registro,
    "Falha ao registrar a atenção da segurança"
  );
  return dados.registro;
}

export async function listarAtencaoSeguranca(
  sessaoId: string,
  limite = 500
): Promise<RegistroAtencaoSeguranca[]> {
  const params = new URLSearchParams({ sessaoId, limit: String(limite) });
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/seguranca/atencao?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler a telemetria de atenção", {
      cause: err,
    });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { registros?: RegistroAtencaoSeguranca[] };
  return dados.registros ?? [];
}