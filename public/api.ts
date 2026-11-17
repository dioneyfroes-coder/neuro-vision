import type { EntradaLog, EventoTemporalEnvio, EventoVisual, MarcacaoNsfwLog, MotivoAnalise, TipoEventoVisual } from "../src/types";
import type { RegistroCiclo } from "../src/domain/cycle";
import type {
  MotivoRejeicaoQuadro,
  QuadroAtribuido,
  QuadroGravado,
  SessaoMonitoramento,
  VideoSegment,
} from "../src/domain/monitoramento";
import type { ArquivoVideoSegmento } from "../src/persistence/armazenador-videos";
import type {
  ItemCena,
  MudancaCena,
  OpcoesComparacaoCena,
  ReferenciaCena,
} from "../src/domain/cena";
import { ErroPercepcao } from "../src/erros";

export interface InfoVisao {
  online: boolean;
  /** URL base do backend consultado (para diagnostico da interface). */
  backend?: string;
  /** Modelo de visao configurado (NEURO_MODEL ou o padrao do servidor). */
  solicitado?: string;
  /** Modelo efetivamente usado (o solicitado ou o melhor disponivel). */
  modelo: string;
  modelos: string[];
  carregados: string[];
  erro: string;
}

export interface PreparacaoVisao {
  modelo?: string;
  carregado?: boolean;
  carregandoMs?: number;
}

export interface EventoVisao {
  type?: string;
  response?: string;
  descricao?: string;
  modelo?: string;
  snapshot?: string;
  erro?: string;
  tokens?: number;
  ms?: number;
  tipo?: string;
  papel?: "base" | "delta";
  semMudanca?: boolean;
  /** Marcacoes NSFW (caixas normalizadas) quando o subsistema rodou. */
  nsfw?: MarcacaoNsfwLog[];
}

export interface PayloadVisao {
  /** Imagem unica (compatibilidade). Ignorada quando `imagens` e informado. */
  imagem?: string;
  /** Varias imagens, na ordem em que devem ser interpretadas (ciclo multiframe). */
  imagens?: string[];
  /** Frames que originaram as imagens; vinculam a inferencia aos ciclos no log. */
  frameIds?: string[];
  /** Prompt explicito, substituindo o padrao do servidor. */
  prompt?: string;
  snapshot?: string;
  /** Instante ISO da captura do frame (antes da inferencia). */
  capturadoEm?: string;
  modelo?: string;
  anterior?: string;
  modo?: "roteiro" | "descricao";
  roteiro?: string;
  base?: boolean;
  /** Razao que acionou esta analise (fluxo orientado a eventos). */
  motivo?: MotivoAnalise;
  /**
   * Marcacoes NSFW (caixas normalizadas) do frame. Presente mesmo vazio quando
   * o subsistema esta ativo; `undefined` = desligado.
   */
  nsfw?: MarcacaoNsfwLog[];
  /**
   * NSFW ativo no fluxo multiframe (as marcacoes ja vao no prompt/contexto).
   * Sinaliza ao servidor para usar exclusivamente o `MODELO_NSFW`.
   */
  nsfwAtivo?: boolean;
  /**
   * Contexto/metadado declarado (nome do clipe, anotacao do usuario). O prompt
   * o trata como declaracao, nunca como observacao visual; identidade de genero
   * so entra por aqui.
   */
  contexto?: string;
}

export interface ResultadoVisao {
  evento: EventoVisao | null;
  parcial: string;
}

/** Erro reportado pelo proprio stream do backend de visao (nao deve ser reembrulhado). */
class ErroEventoVisao extends ErroPercepcao {
  constructor(mensagem: string) {
    super("visao", mensagem);
    this.name = "ErroEventoVisao";
  }
}

async function exigirRespostaOk(resposta: Response, msgPadrao: string): Promise<void> {
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("armazenamento", corpo?.erro ?? `${msgPadrao} (${resposta.status})`);
  }
}

/** `POST /api/log` — grava uma entrada no historico do servidor. */
export async function gravarEntrada(entrada: EntradaLog): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entrada),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar no log do servidor", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar no log do servidor");
}

/** `GET /api/logs` — lista as entradas mais recentes (mais nova primeiro). */
export async function listarEntradas(limite = 100): Promise<EntradaLog[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/logs?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler o historico", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { entradas?: EntradaLog[] };
  return dados.entradas ?? [];
}

/** `DELETE /api/logs` — limpa o historico. */
export async function limparHistorico(): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/logs", { method: "DELETE" });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao limpar o historico", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
}

/** `POST /api/eventos` — grava um evento estruturado (distinto do historico). */
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

/** Filtros de consulta ao historico de eventos (`GET /api/eventos`). */
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

/** `GET /api/eventos` — lista os eventos mais recentes (mais novo primeiro). */
export async function listarEventos(
  limite = 100,
  filtros: FiltrosEventos = {}
): Promise<EventoVisual[]> {
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
  const dados = (await resposta.json()) as { eventos?: EventoVisual[] };
  return dados.eventos ?? [];
}

/**
 * `POST /api/eventos-temporais` — persiste uma atualizacao de gesto/postura/
 * movimento corporal no stream temporal, separado dos fatos visuais.
 */
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

/**
 * `POST /api/ciclos` — grava o diagnostico de um ciclo (metricas por etapa,
 * erros parciais, subsistemas indisponiveis e relacoes sessao/ciclo/frames).
 */
export async function gravarCiclo(registro: RegistroCiclo): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/ciclos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar o diagnostico do ciclo", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar o diagnostico do ciclo");
}

/** `GET /api/ciclos` — lista os diagnosticos de ciclo mais recentes. */
export async function listarCiclos(limite = 50): Promise<RegistroCiclo[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/ciclos?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler os diagnosticos de ciclo", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { ciclos?: RegistroCiclo[] };
  return dados.ciclos ?? [];
}

/** `POST /api/operacional` — registra falha/metrica operacional (nao e evento visual). */
export async function gravarOperacional(registro: {
  nivel?: "info" | "aviso" | "erro";
  origem?: string;
  mensagem: string;
  detalhe?: string;
}): Promise<void> {
  try {
    await fetch("/api/operacional", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
  } catch {
    // Registro operacional e best-effort: nao interrompe a captura.
  }
}

/* ------------------------------------------------------------------------- *
 * Monitoramento (Fase 3) - sessoes, quadros e segmentos
 * ------------------------------------------------------------------------- */

/** Corpo de `POST /api/monitoramento/sessoes`. */
export interface OpcoesIniciarMonitoramento {
  ambiente: string;
  agoraMs?: number;
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}

/** Quadro recusado dentro de um lote (o restante do lote segue). */
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

function urlSessaoMonitoramento(sessaoId: string): string {
  return `/api/monitoramento/sessoes/${encodeURIComponent(sessaoId)}`;
}

async function postMonitoramento<T>(url: string, corpo: unknown, msgPadrao: string): Promise<T> {
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

/** `POST /api/monitoramento/sessoes` - abre uma sessao de gravacao. */
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

/**
 * `POST /api/monitoramento/quadros` - atribui os instantes de captura ao
 * segmento correspondente. Rejeicoes vem em `rejeitados`, sem descartar o
 * restante do lote.
 */
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

/** `POST /api/monitoramento/sessoes/:id/pausar`. */
export async function pausarMonitoramento(sessaoId: string): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    `${urlSessaoMonitoramento(sessaoId)}/pausar`,
    {},
    "Falha ao pausar o monitoramento"
  );
  return dados.sessao;
}

/** `POST /api/monitoramento/sessoes/:id/retomar`. */
export async function retomarMonitoramento(sessaoId: string): Promise<SessaoMonitoramento> {
  const dados = await postMonitoramento<{ sessao: SessaoMonitoramento }>(
    `${urlSessaoMonitoramento(sessaoId)}/retomar`,
    {},
    "Falha ao retomar o monitoramento"
  );
  return dados.sessao;
}

/** `POST /api/monitoramento/sessoes/:id/encerrar`. */
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

/** `POST /api/monitoramento/sessoes/:id/interromper` (falha de gravacao). */
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

/** `GET /api/monitoramento/sessoes` - sessoes conhecidas (mais recente primeiro). */
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

/** `GET /api/monitoramento/sessoes/:id/segmentos` - segmentos de uma sessao. */
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

/**
 * `GET /api/monitoramento/segmentos` - segmentos que tocam o intervalo
 * (extremos inclusivos). Sem `inicio`/`fim`, devolve o indice cronologico.
 */
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

/* ------------------------------------------------------------------------- *
 * Monitoramento (Fase 3) - bytes de video
 * ------------------------------------------------------------------------- */

function urlVideoMonitoramento(segmentoId: string): string {
  return `/api/monitoramento/videos/${encodeURIComponent(segmentoId)}`;
}

/** `POST /api/monitoramento/videos/:id` - envia o blob gravado pelo navegador. */
export async function enviarVideoSegmento(opcoes: {
  segmentoId: string;
  bytes: Blob | Uint8Array;
  contentType: string;
  criadoEmMs?: number;
}): Promise<ArquivoVideoSegmento> {
  const params = new URLSearchParams();
  if (opcoes.criadoEmMs !== undefined) params.set("criadoEmMs", String(opcoes.criadoEmMs));
  const url = `${urlVideoMonitoramento(opcoes.segmentoId)}?${params.toString()}`;
  // `Uint8Array<ArrayBufferLike>` nao e `BodyInit` nas typings atuais; copiar
  // para um ArrayBuffer concreto mantem o contrato simples para o chamador.
  const corpo: Blob =
    opcoes.bytes instanceof Blob
      ? opcoes.bytes
      : new Blob([new Uint8Array(opcoes.bytes)], { type: opcoes.contentType });
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": opcoes.contentType },
      body: corpo,
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao enviar o video do segmento", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao enviar o video do segmento");
  const dados = (await resposta.json()) as { arquivo?: ArquivoVideoSegmento };
  if (!dados.arquivo) throw new ErroPercepcao("armazenamento", "Servidor nao devolveu o arquivo");
  return dados.arquivo;
}

/** `GET /api/monitoramento/videos` - metadados dos videos gravados. */
export async function listarVideosMonitoramento(sessaoId?: string): Promise<ArquivoVideoSegmento[]> {
  const params = new URLSearchParams();
  if (sessaoId) params.set("sessaoId", sessaoId);
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/videos?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao listar os videos", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { arquivos?: ArquivoVideoSegmento[] };
  return dados.arquivos ?? [];
}

/** URL do video bruto, para `<video src>` ou download. */
export function urlVideoSegmento(segmentoId: string): string {
  return urlVideoMonitoramento(segmentoId);
}

/** `DELETE /api/monitoramento/videos/:id`. */
export async function excluirVideoSegmento(segmentoId: string): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(urlVideoMonitoramento(segmentoId), { method: "DELETE" });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao apagar o video", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao apagar o video");
}

/** `DELETE /api/monitoramento/videos?sessaoId=` - apaga todos os videos da sessao. */
export async function excluirVideosDaSessao(sessaoId: string): Promise<number> {
  const params = new URLSearchParams({ sessaoId });
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/videos?${params.toString()}`, {
      method: "DELETE",
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao apagar os videos da sessao", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao apagar os videos da sessao");
  const dados = (await resposta.json()) as { total?: number };
  return dados.total ?? 0;
}

/** `POST /api/monitoramento/videos/retencao` - aplica a politica de retencao. */
export async function aplicarRetencaoVideos(agoraMs?: number): Promise<ArquivoVideoSegmento[]> {
  const params = new URLSearchParams();
  if (agoraMs !== undefined) params.set("agoraMs", String(agoraMs));
  let resposta: Response;
  try {
    resposta = await fetch(`/api/monitoramento/videos/retencao?${params.toString()}`, {
      method: "POST",
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao aplicar a retencao dos videos", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao aplicar a retencao dos videos");
  const dados = (await resposta.json()) as { removidos?: ArquivoVideoSegmento[] };
  return dados.removidos ?? [];
}

/* ------------------------------------------------------------------------- *
 * Monitoramento (Fase 3) - referencia do ambiente e mudancas
 * ------------------------------------------------------------------------- */

function urlCenaMonitoramento(sessaoId: string, acao: string): string {
  return `${urlSessaoMonitoramento(sessaoId)}/cena/${acao}`;
}

/** `POST .../cena/referencia` - consolida o inventario inicial. */
export async function definirReferenciaCena(opcoes: {
  sessaoId: string;
  itens: ItemCena[];
  criadaEmMs?: number;
  quadros?: number;
}): Promise<ReferenciaCena> {
  const dados = await postMonitoramento<{ referencia: ReferenciaCena }>(
    urlCenaMonitoramento(opcoes.sessaoId, "referencia"),
    opcoes,
    "Falha ao salvar a referencia do ambiente"
  );
  return dados.referencia;
}

/** `GET .../cena/referencia` - referencia atual ou `null`. */
export async function obterReferenciaCena(sessaoId: string): Promise<ReferenciaCena | null> {
  let resposta: Response;
  try {
    resposta = await fetch(urlCenaMonitoramento(sessaoId, "referencia"));
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler a referencia do ambiente", {
      cause: err,
    });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { referencia?: ReferenciaCena | null };
  return dados.referencia ?? null;
}

/** `POST .../cena/comparar` - detecta e persiste mudancas. */
export async function compararCenaMonitoramento(opcoes: {
  sessaoId: string;
  itens: ItemCena[];
  agoraMs?: number;
  comparacao?: OpcoesComparacaoCena;
}): Promise<{ mudancas: MudancaCena[]; novas: MudancaCena[] }> {
  const dados = await postMonitoramento<{
    mudancas: MudancaCena[];
    novas: MudancaCena[];
  }>(
    urlCenaMonitoramento(opcoes.sessaoId, "comparar"),
    opcoes,
    "Falha ao comparar a cena com a referencia"
  );
  return { mudancas: dados.mudancas ?? [], novas: dados.novas ?? [] };
}

/** `GET .../cena/mudancas?limit=` - linha do tempo de mudancas. */
export async function listarMudancasCena(
  sessaoId: string,
  limite = 2000
): Promise<MudancaCena[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`${urlCenaMonitoramento(sessaoId, "mudancas")}?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler as mudancas da cena", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { mudancas?: MudancaCena[] };
  return dados.mudancas ?? [];
}

/** Contexto recente reconstruido pelo servidor a partir da memoria persistida. */
export interface ContextoRecente {
  resumo: string;
  roteiro: string[];
  ultimaDescricao: string;
  entradas: EntradaLog[];
  eventos: EventoVisual[];
}

/** `GET /api/contexto` — reconstroi o contexto recente (janela limitada). */
export async function obterContexto(): Promise<ContextoRecente | null> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/contexto");
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao recuperar o contexto", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as Partial<ContextoRecente>;
  return {
    resumo: dados.resumo ?? "",
    roteiro: dados.roteiro ?? [],
    ultimaDescricao: dados.ultimaDescricao ?? "",
    entradas: dados.entradas ?? [],
    eventos: dados.eventos ?? [],
  };
}

/** `GET /api/health` — status do backend de visao. */
export async function saudeVisao(): Promise<InfoVisao | null> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/health");
  } catch (err) {
    throw new ErroPercepcao("visao", "Backend de visao: servidor indisponivel", { cause: err });
  }
  const dados = (await resposta.json()) as { visao?: InfoVisao };
  return dados.visao ?? null;
}

/** `GET /api/visao/preparar` — garante o modelo de visao em memoria. */
export async function prepararVisao(modelo?: string): Promise<PreparacaoVisao> {
  const alvo = modelo?.trim();
  const url = alvo ? `/api/visao/preparar?modelo=${encodeURIComponent(alvo)}` : "/api/visao/preparar";
  let resposta: Response;
  try {
    resposta = await fetch(url);
  } catch (err) {
    throw new ErroPercepcao("visao", "Falha ao contactar o servidor (/api/visao/preparar)", {
      cause: err,
    });
  }
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("visao", corpo?.erro ?? `Falha ao preparar o backend de visao (${resposta.status})`);
  }
  return (await resposta.json()) as PreparacaoVisao;
}

/**
 * `POST /api/visao` — envia o frame e consome o stream NDJSON.
 * `onChunk` recebe o texto parcial acumulado a cada pedaco recebido.
 * Retorna o evento `done` (ou null) e o texto parcial completo.
 */
export async function descreverFrame(
  payload: PayloadVisao,
  signal: AbortSignal,
  onChunk?: (parcial: string) => void
): Promise<ResultadoVisao> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/visao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ErroPercepcao("visao", "Falha ao contactar o servidor (/api/visao)", { cause: err });
  }

  if (!resposta.ok || !resposta.body) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("visao", corpo?.erro ?? `Backend de visao respondeu ${resposta.status}`);
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let parcial = "";
  let evento: EventoVisao | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!linha) continue;
        const evt = JSON.parse(linha) as EventoVisao;
        if (evt.type === "chunk" && evt.response) {
          parcial += evt.response;
          onChunk?.(parcial);
        } else if (evt.type === "done") {
          evento = evt;
        } else if (evt.type === "erro") {
          throw new ErroEventoVisao(evt.erro ?? "Erro no backend de visao");
        }
      }
    }
  } catch (err) {
    if (err instanceof ErroEventoVisao) throw err;
    if ((err as Error).name === "AbortError") throw err;
    throw new ErroPercepcao("visao", `Erro ao ler resposta do backend de visao: ${(err as Error).message}`, {
      cause: err,
    });
  }

  return { evento, parcial };
}
