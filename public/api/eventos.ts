import type {
  EventoVisual,
  EventoVisualComVideo,
  EventoTemporalComVideo,
  EventoTemporalEnvio,
  TipoEventoVisual,
} from "../../src/types";
import type { EstadoEventoTemporal, TipoEventoTemporal } from "../../src/domain/temporal-event";
import { ErroPercepcao } from "../../src/erros";
import { exigirRespostaOk } from "./http";

export async function gravarEvento(evento: EventoVisual): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/eventos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(evento),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar evento no servidor", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar evento no servidor");
}

export interface FiltrosEventos {
  /** Tipos aceitos; vazio/omisso = todos. */
  tipos?: TipoEventoVisual[];
  /** Somente eventos deste objeto rastreado. */
  objetoId?: string;
  /** Inicio da janela (epoch ms, inclusive). */
  desde?: number;
  /** Fim da janela (epoch ms, inclusive). */
  ate?: number;
}

export async function listarEventos(
  limite = 100,
  filtros: FiltrosEventos = {}
): Promise<EventoVisualComVideo[]> {
  const params = new URLSearchParams({ limit: String(limite) });
  if (filtros.tipos?.length) params.set("tipo", filtros.tipos.join(","));
  if (filtros.objetoId) params.set("objetoId", filtros.objetoId);
  if (filtros.desde !== undefined) params.set("desde", String(filtros.desde));
  if (filtros.ate !== undefined) params.set("ate", String(filtros.ate));

  let resposta: Response;
  try {
    resposta = await fetch(`/api/eventos?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler os eventos", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { eventos?: EventoVisualComVideo[] };
  return dados.eventos ?? [];
}

export async function gravarEventoTemporal(evento: EventoTemporalEnvio): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/eventos-temporais", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(evento),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar evento temporal", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar evento temporal");
}

export interface FiltrosEventosTemporais {
  tipos?: TipoEventoTemporal[];
  estados?: EstadoEventoTemporal[];
  entidadeId?: string;
  sessionId?: string;
  /** Rotulo do objeto detector (`rotuloObjeto`), CSV. */
  objetos?: string[];
  /** Qualquer participante da interacao (`participantes`), CSV. */
  participantes?: string[];
  segmentoId?: string;
  desde?: number | string;
  ate?: number | string;
}

export async function listarEventosTemporais(
  limite = 100,
  filtros: FiltrosEventosTemporais = {}
): Promise<EventoTemporalComVideo[]> {
  const params = new URLSearchParams({ limit: String(limite) });
  if (filtros.tipos?.length) params.set("tipo", filtros.tipos.join(","));
  if (filtros.estados?.length) params.set("estado", filtros.estados.join(","));
  if (filtros.entidadeId) params.set("entidadeId", filtros.entidadeId);
  if (filtros.sessionId) params.set("sessionId", filtros.sessionId);
  if (filtros.objetos?.length) params.set("objeto", filtros.objetos.join(","));
  if (filtros.participantes?.length) params.set("participante", filtros.participantes.join(","));
  if (filtros.segmentoId) params.set("segmentoId", filtros.segmentoId);
  if (filtros.desde !== undefined) params.set("desde", String(filtros.desde));
  if (filtros.ate !== undefined) params.set("ate", String(filtros.ate));

  let resposta: Response;
  try {
    resposta = await fetch(`/api/eventos-temporais?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler a linha do tempo temporal", {
      cause: err,
    });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { eventos?: EventoTemporalComVideo[] };
  return dados.eventos ?? [];
}