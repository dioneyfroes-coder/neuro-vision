import { estaIndisponivel } from "../../src/domain";
import type {
  ObservacaoFrame,
  PacoteCiclo,
  ResultadoOuIndisponivel,
} from "../../src/domain";
import {
  arredondar,
  calcularMovimento,
  estadoSubsistema,
  serializarDeteccoes,
  serializarMaos,
  serializarNsfw,
  serializarPessoas,
  OPCOES_SERIALIZACAO_PADRAO,
  VERSAO_ESQUEMA_CONTEXTO,
  type ContextoCicloSerializavel,
  type EventoTemporalSerializavel,
  type ObservacaoLocalSerializavel,
  type OpcoesSerializacao,
} from "./esquema";

/** Reexporta o schema versionado para consumidores do contexto. */
export * from "./esquema";

/**
 * Montagem do contexto estruturado de um ciclo (Etapa 7 do roteiro).
 *
 * Converte o `PacoteCiclo` num conjunto de registros JSON **versionados** (ver
 * `esquema.ts`): deteccoes com caixas normalizadas e score individual, pessoas
 * com keypoints nomeados e identidade de track, maos com lateralidade/gesto e
 * landmarks, movimento entre frames, estado por subsistema e eventos temporais
 * com status/evidencias/gap. Substitui os resumos textuais anteriores por
 * evidencia estruturada, respeitando tetos de tamanho e de dados numericos.
 *
 * Cada frame do contexto corresponde a **uma imagem**, na mesma ordem; o campo
 * `indice` (1-based) liga o texto enviado ao modelo a imagem correta.
 *
 * A **evidencia observada** (detectores) permanece em `frames`/`eventosTemporais`;
 * a **inferencia textual** do modelo vai separada em `inferencia` (ver
 * `InferenciaMultimodalSerializavel`), sem fundir os dois graus de certeza.
 */

export interface LimitesContexto {
  /** Maximo de imagens/frames enviados (os mais recentes). */
  maxImagens: number;
  /** Maximo de eventos temporais incluidos. */
  maxEventos: number;
  /** Maximo de pontos corporais relevantes por frame (legado; ver `opcoes`). */
  maxPontosPorFrame: number;
  /** Casas decimais para coordenadas/confiancas (limita dados numericos). */
  decimais: number;
  /** Teto aproximado do JSON do contexto (bytes). */
  maxBytesContexto: number;
}

export const LIMITES_CONTEXTO_PADRAO: LimitesContexto = {
  maxImagens: 4,
  maxEventos: 20,
  maxPontosPorFrame: 6,
  decimais: 2,
  maxBytesContexto: 16_000,
};

export interface PayloadContexto {
  /** Imagens (data URL) na ordem dos frames do contexto. */
  imagens: string[];
  contexto: ContextoCicloSerializavel;
}

/** Opcoes de montagem do contexto (Etapa 9). */
export interface OpcoesContexto {
  /**
   * Inclui no contexto os dados derivados da percepcao local (deteccoes, pose,
   * maos, movimento e eventos temporais). Na variante B (`false`) vao ao
   * multimodal apenas as imagens e a cronologia (`frameId`, `indice`,
   * `capturadoEm`, `offsetMs`), para isolar o valor do contexto entre imagens.
   */
  incluirDadosLocais?: boolean;
  /**
   * Serializacao do schema (decimais, keypoints, limites por frame). Default:
   * `OPCOES_SERIALIZACAO_PADRAO`, com `decimais` herdado de `LimitesContexto`.
   */
  serializacao?: Partial<OpcoesSerializacao>;
}

/**
 * Monta o contexto estruturado e a lista de imagens do ciclo, na ordem
 * cronologica, respeitando os limites (tamanho e dados numericos).
 */
export function montarContextoCiclo(
  pacote: PacoteCiclo,
  limites: Partial<LimitesContexto> = {},
  opcoes: OpcoesContexto = {}
): PayloadContexto {
  const cfg: LimitesContexto = { ...LIMITES_CONTEXTO_PADRAO, ...limites };
  const serializacao: OpcoesSerializacao = {
    ...OPCOES_SERIALIZACAO_PADRAO,
    decimais: cfg.decimais,
    ...opcoes.serializacao,
  };
  const incluirDadosLocais = opcoes.incluirDadosLocais ?? true;
  const ordenadas = [...pacote.observacoes].sort((a, b) => a.capturadoEmMs - b.capturadoEmMs);
  const selecionadas = amostrar(ordenadas, cfg.maxImagens);
  const baseMs = selecionadas.length > 0 ? selecionadas[0].capturadoEmMs : 0;

  const frames: ObservacaoLocalSerializavel[] = [];
  // Posicoes do frame anterior (por `tipo:trackId`) para calcular movimento.
  let posicoesAnteriores = new Map<string, { x: number; y: number; tMs: number }>();

  selecionadas.forEach((obs, i) => {
    const montado = montarObservacao(obs, i + 1, Math.round(obs.capturadoEmMs - baseMs), {
      incluirDadosLocais,
      serializacao,
      posicoesAnteriores,
    });
    posicoesAnteriores = montado.posicoes;
    frames.push(montado.observacao);
  });

  const eventosTemporais = incluirDadosLocais
    ? pacote.eventosTemporais
        .slice(0, cfg.maxEventos)
        .map((e) => serializarEvento(e, serializacao.decimais))
    : [];

  const indisponibilidades = incluirDadosLocais ? coletarIndisponibilidades(ordenadas) : [];

  const janelaMs =
    ordenadas.length > 1
      ? Math.round(ordenadas[ordenadas.length - 1].capturadoEmMs - ordenadas[0].capturadoEmMs)
      : 0;

  const contexto: ContextoCicloSerializavel = {
    versao: VERSAO_ESQUEMA_CONTEXTO,
    sessionId: pacote.sessionId,
    cycleId: pacote.cycleId,
    iniciadoEm: pacote.iniciadoEm,
    janelaMs,
    frames,
    eventosTemporais,
    resumoTemporal: {
      entidadesAtivas: incluirDadosLocais ? pacote.resumoTemporal.entidadesAtivas : 0,
      houveIntervaloSemObservacao: incluirDadosLocais
        ? Boolean(pacote.resumoTemporal.houveIntervaloSemObservacao)
        : false,
      intervaloSemObservacaoMs: incluirDadosLocais
        ? pacote.resumoTemporal.intervaloSemObservacaoMs
        : undefined,
    },
    indisponibilidades,
  };

  limitarPorBytes(contexto, cfg.maxBytesContexto);

  return { imagens: selecionadas.map((obs) => obs.imagem), contexto };
}

/** Resultado interno da montagem de um frame, com o mapa de posicoes. */
interface FrameMontado {
  observacao: ObservacaoLocalSerializavel;
  posicoes: Map<string, { x: number; y: number; tMs: number }>;
}

function montarObservacao(
  obs: ObservacaoFrame,
  indice: number,
  offsetMs: number,
  ctx: {
    incluirDadosLocais: boolean;
    serializacao: OpcoesSerializacao;
    posicoesAnteriores: Map<string, { x: number; y: number; tMs: number }>;
  }
): FrameMontado {
  const { incluirDadosLocais, serializacao } = ctx;
  const dimensoes = estaIndisponivel(obs.deteccoes) ? undefined : obs.deteccoes.dimensoes;

  // Variante B: so cronologia, sem dados locais — os subsistemas ficam marcados
  // como nao executados para nao sugerir "indisponivel" (nao houve tentativa).
  if (!incluirDadosLocais) {
    const naoExecutado = { status: "nao_carregado" as const };
    return {
      observacao: {
        versao: VERSAO_ESQUEMA_CONTEXTO,
        frameId: obs.frameId,
        indice,
        capturadoEm: obs.capturadoEm,
        offsetMs,
        subsistemas: { deteccao: naoExecutado, pose: naoExecutado, maos: naoExecutado },
        deteccoes: [],
        pessoas: [],
        maos: [],
        movimento: [],
      },
      posicoes: ctx.posicoesAnteriores,
    };
  }

  const subsistemas = {
    deteccao: estadoSubsistema(obs.deteccoes, obs.metricas.subsistemas?.deteccao, (r) => r.deteccoes.length === 0),
    pose: estadoSubsistema(obs.pose, obs.metricas.subsistemas?.pose, (r) => r.pessoas.length === 0),
    maos: estadoSubsistema(obs.maos, obs.metricas.subsistemas?.maos, (r) => r.maos.length === 0),
    ...(obs.nsfw !== undefined
      ? { nsfw: estadoSubsistema(obs.nsfw, obs.metricas.subsistemas?.nsfw, (r) => r.marcacoes.length === 0) }
      : {}),
  };

  const movimento = calcularMovimento(obs, ctx.posicoesAnteriores, serializacao.decimais);

  const observacao: ObservacaoLocalSerializavel = {
    versao: VERSAO_ESQUEMA_CONTEXTO,
    frameId: obs.frameId,
    indice,
    capturadoEm: obs.capturadoEm,
    offsetMs,
    subsistemas,
    deteccoes: serializarDeteccoes(obs.deteccoes, serializacao),
    pessoas: serializarPessoas(obs.pose, serializacao),
    maos: serializarMaos(obs.maos, serializacao),
    movimento: movimento.movimentos,
  };
  if (obs.nsfw !== undefined) {
    observacao.nsfw = serializarNsfw(obs.nsfw, dimensoes, serializacao);
  }
  return { observacao, posicoes: movimento.posicoes };
}

function serializarEvento(
  evento: PacoteCiclo["eventosTemporais"][number],
  decimais: number
): EventoTemporalSerializavel {
  const serializado: EventoTemporalSerializavel = {
    eventoId: evento.eventoId,
    tipo: evento.tipo,
    descricao: evento.descricao,
    inicioEm: evento.inicioEm,
    status: evento.estado,
    evidencias: evento.frameIds.slice(0, 8),
  };
  if (evento.fimEm !== undefined) serializado.fimEm = evento.fimEm;
  if (evento.entidadeId !== undefined) serializado.trackId = evento.entidadeId;
  if (evento.confianca !== undefined) serializado.confianca = arredondar(evento.confianca, decimais);
  if (evento.intervaloSemObservacaoMs !== undefined) {
    serializado.gapMs = evento.intervaloSemObservacaoMs;
  }
  return serializado;
}

/** Mantem no maximo `max` frames, preservando o primeiro e o ultimo. */
function amostrar<T>(itens: T[], max: number): T[] {
  if (itens.length <= max) return itens;
  if (max <= 1) return [itens[itens.length - 1]];
  const passo = (itens.length - 1) / (max - 1);
  const resultado: T[] = [];
  for (let i = 0; i < max; i += 1) {
    resultado.push(itens[Math.round(i * passo)]);
  }
  return resultado;
}

function coletarIndisponibilidades(observacoes: ObservacaoFrame[]): string[] {
  const vistos = new Set<string>();
  observacoes.forEach((obs, i) => {
    const pares: Array<[string, ResultadoOuIndisponivel<unknown> | undefined]> = [
      ["deteccao", obs.deteccoes],
      ["pose", obs.pose],
      ["maos", obs.maos],
      // `nsfw` undefined = subsistema desligado: nao e indisponibilidade.
      ["nsfw", obs.nsfw],
    ];
    for (const [nome, res] of pares) {
      if (estaIndisponivel(res)) {
        vistos.add(`frame ${i + 1}: ${nome} indisponivel (${res.motivo})`);
      }
    }
  });
  return [...vistos];
}

/**
 * Reduz o contexto ate caber no teto, sem quebrar a correspondencia entre
 * frame e imagem. Ordem de descarte (do mais caro/menos critico ao essencial):
 * 1. landmarks completos de mao; 2. keypoints alem dos essenciais; 3. movimento;
 * 4. eventos temporais; 5. deteccoes/pessoas restantes. `frameId`, timestamp,
 * `versao`, o estado do subsistema e as **marcacoes NSFW** nunca sao removidos:
 * quando o classificador esta ativo, a informacao +18 e evidencia essencial.
 */
function limitarPorBytes(contexto: ContextoCicloSerializavel, maxBytes: number): void {
  if (tamanhoBytes(contexto) <= maxBytes) return;

  // 1. Landmarks de mao: mantem apenas os pontas/articulacoes compactas.
  for (const frame of contexto.frames) {
    for (const mao of frame.maos) {
      if (mao.landmarks.length > 6) mao.landmarks = mao.landmarks.slice(0, 6);
    }
  }
  if (tamanhoBytes(contexto) <= maxBytes) return;

  // 2. Keypoints: mantem apenas os mais confiaveis por pessoa.
  for (const frame of contexto.frames) {
    for (const pessoa of frame.pessoas) {
      if (pessoa.keypoints.length > 6) pessoa.keypoints = pessoa.keypoints.slice(0, 6);
    }
  }
  if (tamanhoBytes(contexto) <= maxBytes) return;

  // 3. Movimento (derivavel de posicoes; menos critico que a evidencia bruta).
  for (const frame of contexto.frames) frame.movimento = [];
  if (tamanhoBytes(contexto) <= maxBytes) return;

  // 4. Eventos temporais.
  contexto.eventosTemporais = [];
  if (tamanhoBytes(contexto) <= maxBytes) return;

  // 5. Deteccoes menos confiaveis primeiro; depois pessoas/maos alem da primeira.
  // As marcacoes NSFW ficam intactas de proposito: sao a evidencia +18 que o
  // modelo precisa para descrever o conteudo sem omitir.
  for (const frame of contexto.frames) {
    frame.deteccoes = frame.deteccoes.slice(0, 3);
    frame.pessoas = frame.pessoas.slice(0, 2);
    frame.maos = frame.maos.slice(0, 2);
  }
}

function tamanhoBytes(valor: unknown): number {
  return JSON.stringify(valor).length;
}
