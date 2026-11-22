export  { obterContexto } from "./api/contexto";
export type { ContextoRecente } from "./api/contexto";

export type {
  EventoVisao,
  InfoVisao,
  PayloadVisao,
  PreparacaoVisao,
  ResultadoVisao,
} from "./api/http";

export  { gravarEvento, gravarEventoTemporal, listarEventos, listarEventosTemporais } from "./api/eventos";
export type { FiltrosEventos, FiltrosEventosTemporais } from "./api/eventos";

export  { saudeSistema, saudeVisao } from "./api/saude";
export type { InfoSistema, RespostaSaude } from "./api/saude";

export  {
  encerrarMonitoramento,
  enviarQuadrosMonitoramento,
  gravarAtencaoSeguranca,
  listarAtencaoSeguranca,
  iniciarMonitoramento,
  interromperMonitoramento,
  listarSegmentosDaSessao,
  listarSegmentosMonitoramento,
  listarSessoesMonitoramento,
  pausarMonitoramento,
  retomarMonitoramento,
} from "./api/monitoramento";
export type { OpcoesIniciarMonitoramento, RejeicaoQuadroMonitoramento, ResultadoQuadrosMonitoramento } from "./api/monitoramento";

export  {
  aplicarRetencaoVideos,
  enviarVideoSegmento,
  excluirVideoSegmento,
  excluirVideosDaSessao,
  listarVideosMonitoramento,
  urlVideoSegmento,
} from "./api/videos";

export  { compararCenaMonitoramento, definirReferenciaCena, listarMudancasCena, obterReferenciaCena, revisarMudancaCena } from "./api/cena";

export  { descreverFrame, prepararVisao } from "./api/visao";

export  { gravarCiclo, gravarOperacional, listarCiclos } from "./api/ciclos";

export  { gravarEntrada, limparHistorico, listarEntradas } from "./api/historico";