import {
  estaIndisponivel,
  type Caixa,
  type ObservacaoFrame,
  type PessoaPose,
  type PontoCorporal,
  type ResultadoDeteccaoLocal,
  type ResultadoMaos,
  type ResultadoNsfw,
  type ResultadoOuIndisponivel,
  type ResultadoPose,
} from "../../src/domain";

/**
 * Schema **versionado** do contexto local enviado ao modelo multimodal
 * (Fase 3, itens 1-4, 6 e 7).
 *
 * Substitui os resumos textuais por registros JSON estruturados, com
 * `evidencia` observada pelo detector separada da `inferencia` textual do
 * modelo. Cada registro carrega `frameId`, timestamp e a versao do esquema, de
 * modo que **toda afirmacao relevante pode ser vinculada a um frame e a uma
 * evidencia disponivel** (criterio de saida da Fase 3).
 *
 * Regras:
 * - caixas normalizadas em [0, 1] (relativas as dimensoes do frame);
 * - keypoints corporais **nomeados** (ordem COCO de 17 pontos), com confianca;
 * - maos com lateralidade, gesto/score e landmarks normalizados (compactados);
 * - estado do subsistema (`ok`/`sem_resultado`/`indisponivel`/`nao_carregado`) +
 *   motivo, nunca lista vazia indistinguivel de falha;
 * - movimento entre frames (deslocamento/direcao), nao so posicao isolada.
 */

/** Versao do schema. Sobe quando a forma dos campos muda de modo incompativel. */
export const VERSAO_ESQUEMA_CONTEXTO = "contexto-1";

/** Estado observado de um subsistema de percepcao num frame. */
export type EstadoObservado = "ok" | "sem_resultado" | "indisponivel" | "nao_carregado";

/**
 * Nomes dos 17 keypoints na ordem COCO usada pelo estimador de pose padrao
 * (YOLOv8-pose). O indice no array `pontos` corresponde a posicao aqui.
 */
export const NOMES_KEYPOINTS_COCO: readonly string[] = [
  "nariz",
  "olho_esquerdo",
  "olho_direito",
  "orelha_esquerda",
  "orelha_direita",
  "ombro_esquerdo",
  "ombro_direito",
  "cotovelo_esquerdo",
  "cotovelo_direito",
  "punho_esquerdo",
  "punho_direito",
  "quadril_esquerdo",
  "quadril_direito",
  "joelho_esquerdo",
  "joelho_direito",
  "tornozelo_esquerdo",
  "tornozelo_direito",
];

/** Caixa normalizada em [0, 1] (relativa as dimensoes do frame). */
export interface CaixaNormalizada {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** Deteccao observada pelo detector de objetos. */
export interface DeteccaoObservada {
  /** Rotulo do detector, em portugues quando traduzivel (ex.: `pessoa`). */
  label: string;
  /** Rotulo original do detector (ex.: `person`). */
  rotulo: string;
  score: number;
  caixa: CaixaNormalizada;
  /** Id de entidade estavel na sessao, quando o rastreador o atribuiu. */
  trackId?: string;
}

/** Keypoint nomeado com confianca por ponto. */
export interface KeypointNomeado {
  nome: string;
  x: number;
  y: number;
  confianca?: number;
}

/** Pessoa observada (pose) com keypoints nomeados e identidade de track. */
export interface PessoaObservada {
  /** Indice 1-based da pessoa no frame (ordem do estimador). */
  indice: number;
  /** Id de entidade estavel na sessao, quando disponivel. */
  trackId?: string;
  confianca?: number;
  keypoints: KeypointNomeado[];
}

/** Mao observada com lateralidade, gesto e landmarks normalizados. */
export interface MaoObservada {
  indice: number;
  trackId?: string;
  lateralidade: "esquerda" | "direita" | "desconhecida";
  /** Gesto classificado pelo modelo, quando houver. */
  gesto?: { nome: string; confianca: number };
  /**
   * Landmarks normalizados. Por padrao envia um subconjunto compacto (pontas e
   * articulacoes principais); `landmarksCompletos` marca quando os 21 vao no
   * registro.
   */
  landmarks: Array<{ nome: string; x: number; y: number }>;
  landmarksCompletos: boolean;
}

/** Marcacao NSFW observada (rotulos do proprio modelo, em ingles). */
export interface MarcacaoNsfwObservada {
  rotulo: string;
  score: number;
  caixa: CaixaNormalizada;
}

/** Movimento de uma entidade entre frames (deslocamento/direcao). */
export interface MovimentoObservado {
  /** Id de entidade rastreada (o mesmo usado por deteccoes/pessoas/maos). */
  trackId: string;
  /** Tipo de entidade, para desambiguar ids de rastreadores distintos. */
  tipo: "objeto" | "pessoa" | "mao";
  /** Deslocamento (norma do vetor) em coordenadas normalizadas. */
  deslocamento: number;
  /** Direcao do deslocamento em graus [0, 360), topo = 0, sentido horario. */
  direcaoGraus: number;
  /** Intervalo (ms) entre a posicao atual e a anterior observada. */
  intervaloMs: number;
}

/** Estado observado de um subsistema num frame, com motivo legivel. */
export interface EstadoSubsistemaObservado {
  status: EstadoObservado;
  /** Motivo legivel quando o subsistema nao entregou resultado. */
  motivo?: string;
  /** Modelo em uso, quando a telemetria o expoe. */
  modelo?: string;
}

/**
 * Observacao local de um frame no schema versionado. Cada registro carrega
 * `frameId`, timestamp e versao — a base para vincular afirmacoes a evidencia.
 */
export interface ObservacaoLocalSerializavel {
  /** Versao do schema (permite evolucao sem quebrar consumidores). */
  versao: string;
  frameId: string;
  /** Indice 1-based da imagem correspondente, na ordem enviada. */
  indice: number;
  capturadoEm: string;
  /** Deslocamento em ms em relacao ao primeiro frame da janela. */
  offsetMs: number;
  /** Estado por subsistema: nunca lista vazia indistinguivel de falha. */
  subsistemas: {
    deteccao: EstadoSubsistemaObservado;
    pose: EstadoSubsistemaObservado;
    maos: EstadoSubsistemaObservado;
    /** NSFW: presente apenas quando o subsistema rodou neste frame. */
    nsfw?: EstadoSubsistemaObservado;
  };
  deteccoes: DeteccaoObservada[];
  pessoas: PessoaObservada[];
  maos: MaoObservada[];
  /** Movimento das entidades rastreadas, relativo ao frame anterior observado. */
  movimento: MovimentoObservado[];
  /** Marcacoes NSFW, apenas quando o subsistema rodou neste frame. */
  nsfw?: MarcacaoNsfwObservada[];
}

/** Evento temporal no schema versionado (item 5). */
export interface EventoTemporalSerializavel {
  eventoId: string;
  tipo: string;
  descricao: string;
  inicioEm: string;
  /** Ultima evidencia positiva; ausente enquanto o evento esta ativo. */
  fimEm?: string;
  /** Ciclo de vida: `candidato`/`confirmado`/`encerrado`/`incerto`. */
  status: string;
  /** Id de entidade associada, quando houver. */
  trackId?: string;
  confianca?: number;
  /** Frames de evidencia, em ordem cronologica. */
  evidencias: string[];
  /** Lacuna de observacao (ms) que interrompeu o evento, quando houver. */
  gapMs?: number;
}

/** Inferencia textual do modelo, separada da evidencia observada (item 7). */
export interface InferenciaMultimodalSerializavel {
  resumo: string;
  acoes: Array<{
    descricao: string;
    inicioEm?: string;
    fimEm?: string;
    /** Evidencias citadas pelo modelo, ja validadas contra frames/eventos. */
    evidencias: string[];
    /** Evidencias citadas que nao existem (normalizadas/removidas). */
    evidenciasInvalidas: string[];
  }>;
  incertezas: string[];
  contradicoes: string[];
}

/** Contexto do ciclo no schema versionado. */
export interface ContextoCicloSerializavel {
  versao: string;
  sessionId: string;
  cycleId: string;
  iniciadoEm: string;
  /** Duracao total observada da janela (ms). */
  janelaMs: number;
  frames: ObservacaoLocalSerializavel[];
  eventosTemporais: EventoTemporalSerializavel[];
  resumoTemporal: {
    entidadesAtivas: number;
    houveIntervaloSemObservacao: boolean;
    /** Duracao (ms) do periodo cego anterior ao ciclo, quando houver. */
    intervaloSemObservacaoMs?: number;
  };
  /** Subsistemas indisponiveis (sinalizacao de falha != ausencia). */
  indisponibilidades: string[];
}

/** Limites de resolucao/normalizacao usados na montagem do schema. */
export interface OpcoesSerializacao {
  /** Casas decimais para coordenadas/confiancas. */
  decimais: number;
  /** Inclui os 21 landmarks de mao (em vez do subconjunto compacto). */
  landmarksCompletos: boolean;
  /** Confianca minima para manter um keypoint nomeado no registro. */
  confiancaMinimaKeypoint: number;
  /** Maximo de keypoints nomeados por pessoa (os mais confiaveis). */
  maxKeypointsPorPessoa: number;
  /** Confianca minima para manter uma deteccao no registro. */
  confiancaMinimaDeteccao: number;
  /** Maximo de deteccoes por frame. */
  maxDeteccoesPorFrame: number;
  /** Maximo de pessoas por frame. */
  maxPessoasPorFrame: number;
  /** Maximo de maos por frame. */
  maxMaosPorFrame: number;
}

export const OPCOES_SERIALIZACAO_PADRAO: OpcoesSerializacao = {
  decimais: 2,
  landmarksCompletos: false,
  confiancaMinimaKeypoint: 0.3,
  maxKeypointsPorPessoa: 17,
  confiancaMinimaDeteccao: 0,
  maxDeteccoesPorFrame: 20,
  maxPessoasPorFrame: 8,
  maxMaosPorFrame: 8,
};

/** Indices dos landmarks de mao nos 21 pontos do MediaPipe (subconjunto). */
const LANDMARKS_MAO_COMPACTOS: Array<{ indice: number; nome: string }> = [
  { indice: 0, nome: "punho" },
  { indice: 4, nome: "polegar_ponta" },
  { indice: 8, nome: "indicador_ponta" },
  { indice: 12, nome: "medio_ponta" },
  { indice: 16, nome: "anular_ponta" },
  { indice: 20, nome: "mindinho_ponta" },
];

/** Converte um valor de score que pode vir do modelo num [0, 1] seguro. */
function limitar01(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

export function arredondar(valor: number, decimais: number): number {
  if (!Number.isFinite(valor)) return 0;
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}

/** Normaliza uma caixa em pixels para [0, 1] usando as dimensoes do frame. */
export function normalizarCaixa(
  caixa: Caixa,
  dimensoes: { largura: number; altura: number } | undefined,
  decimais: number
): CaixaNormalizada {
  const largura = dimensoes && dimensoes.largura > 0 ? dimensoes.largura : 1;
  const altura = dimensoes && dimensoes.altura > 0 ? dimensoes.altura : 1;
  return {
    xmin: arredondar(limitar01(caixa.xmin / largura), decimais),
    ymin: arredondar(limitar01(caixa.ymin / altura), decimais),
    xmax: arredondar(limitar01(caixa.xmax / largura), decimais),
    ymax: arredondar(limitar01(caixa.ymax / altura), decimais),
  };
}

/** Estado observado de um subsistema, derivado do resultado + telemetria. */
export function estadoSubsistema<T>(
  resultado: ResultadoOuIndisponivel<T> | undefined,
  telemetria: { status?: EstadoObservado; modelo?: string; motivoFalha?: string } | undefined,
  vazio: (valor: T) => boolean
): EstadoSubsistemaObservado {
  if (resultado === undefined) {
    return {
      status: telemetria?.status ?? "nao_carregado",
      modelo: telemetria?.modelo,
      motivo: telemetria?.motivoFalha,
    };
  }
  if (estaIndisponivel(resultado)) {
    return {
      status: "indisponivel",
      modelo: telemetria?.modelo,
      motivo: resultado.motivo,
    };
  }
  const status: EstadoObservado = vazio(resultado) ? "sem_resultado" : "ok";
  return {
    status,
    modelo: telemetria?.modelo ?? (resultado as { modelo?: string }).modelo,
  };
}

/** Serializa as deteccoes de um frame (caixas normalizadas, score, trackId). */
export function serializarDeteccoes(
  resultado: ResultadoOuIndisponivel<ResultadoDeteccaoLocal>,
  opcoes: OpcoesSerializacao
): DeteccaoObservada[] {
  if (estaIndisponivel(resultado)) return [];
  return resultado.deteccoes
    .filter((d) => d.score >= opcoes.confiancaMinimaDeteccao)
    .slice(0, opcoes.maxDeteccoesPorFrame)
    .map((d) => ({
      label: d.nome || d.rotulo || "objeto",
      rotulo: d.rotulo || d.nome || "objeto",
      score: arredondar(limitar01(d.score), opcoes.decimais),
      caixa: normalizarCaixa(d.caixa, resultado.dimensoes, opcoes.decimais),
    }));
}

/** Serializa as pessoas de um frame com keypoints nomeados. */
export function serializarPessoas(
  resultado: ResultadoOuIndisponivel<ResultadoPose>,
  opcoes: OpcoesSerializacao
): PessoaObservada[] {
  if (estaIndisponivel(resultado)) return [];
  return resultado.pessoas.slice(0, opcoes.maxPessoasPorFrame).map((pessoa, i) =>
    serializarPessoa(pessoa, i + 1, opcoes)
  );
}

function serializarPessoa(
  pessoa: PessoaPose,
  indice: number,
  opcoes: OpcoesSerializacao
): PessoaObservada {
  const pontos = pessoa.pontos
    .map((ponto, i) => ({ ponto, i }))
    .filter(({ ponto }) => pontoValido(ponto, opcoes.confiancaMinimaKeypoint))
    .sort((a, b) => (b.ponto.confianca ?? 1) - (a.ponto.confianca ?? 1))
    .slice(0, opcoes.maxKeypointsPorPessoa);
  const keypoints: KeypointNomeado[] = pontos.map(({ ponto, i }) =>
    serializarKeypoint(ponto, i, opcoes.decimais)
  );
  const observada: PessoaObservada = { indice, keypoints };
  if (pessoa.entidadeId) observada.trackId = pessoa.entidadeId;
  if (pessoa.confianca !== undefined) observada.confianca = arredondar(pessoa.confianca, opcoes.decimais);
  return observada;
}

function serializarKeypoint(
  ponto: PontoCorporal,
  indice: number,
  decimais: number
): KeypointNomeado {
  const nome = NOMES_KEYPOINTS_COCO[indice] ?? `ponto_${indice}`;
  const keypoint: KeypointNomeado = {
    nome,
    x: arredondar(ponto.x, decimais),
    y: arredondar(ponto.y, decimais),
  };
  if (ponto.confianca !== undefined) keypoint.confianca = arredondar(ponto.confianca, decimais);
  return keypoint;
}

function pontoValido(ponto: PontoCorporal, confiancaMinima: number): boolean {
  if (!ponto || typeof ponto.x !== "number" || typeof ponto.y !== "number") return false;
  if (ponto.confianca !== undefined && ponto.confianca < confiancaMinima) return false;
  return true;
}

/** Serializa as maos de um frame (lateralidade, gesto e landmarks). */
export function serializarMaos(
  resultado: ResultadoOuIndisponivel<ResultadoMaos>,
  opcoes: OpcoesSerializacao
): MaoObservada[] {
  if (estaIndisponivel(resultado)) return [];
  return resultado.maos.slice(0, opcoes.maxMaosPorFrame).map((mao, i) => {
    const observada: MaoObservada = {
      indice: i + 1,
      lateralidade: mao.lateralidade,
      landmarks: serializarLandmarksMao(mao.landmarks, opcoes),
      landmarksCompletos: opcoes.landmarksCompletos,
    };
    if (mao.entidadeId) observada.trackId = mao.entidadeId;
    if (mao.gesto) {
      observada.gesto = {
        nome: mao.gesto.nome,
        confianca: arredondar(limitar01(mao.gesto.confianca), opcoes.decimais),
      };
    }
    return observada;
  });
}

function serializarLandmarksMao(
  landmarks: Array<{ x: number; y: number }>,
  opcoes: OpcoesSerializacao
): Array<{ nome: string; x: number; y: number }> {
  const indices = opcoes.landmarksCompletos
    ? landmarks.map((_, i) => ({ indice: i, nome: `landmark_${i}` }))
    : LANDMARKS_MAO_COMPACTOS;
  const saida: Array<{ nome: string; x: number; y: number }> = [];
  for (const { indice, nome } of indices) {
    const ponto = landmarks[indice];
    if (!ponto) continue;
    saida.push({
      nome,
      x: arredondar(ponto.x, opcoes.decimais),
      y: arredondar(ponto.y, opcoes.decimais),
    });
  }
  return saida;
}

/** Serializa as marcacoes NSFW de um frame, quando o subsistema rodou. */
export function serializarNsfw(
  resultado: ResultadoOuIndisponivel<ResultadoNsfw>,
  dimensoes: { largura: number; altura: number } | undefined,
  opcoes: OpcoesSerializacao
): MarcacaoNsfwObservada[] {
  if (estaIndisponivel(resultado)) return [];
  return resultado.marcacoes.map((m) => ({
    rotulo: m.rotulo,
    score: arredondar(limitar01(m.score), opcoes.decimais),
    caixa: normalizarCaixa(m.caixa, dimensoes, opcoes.decimais),
  }));
}

/** Resultado parcial do calculo de movimento para uma observacao. */
export interface ResultadoMovimento {
  movimentos: MovimentoObservado[];
  /**
   * Posicoes normalizadas no fim do frame, por `tipo:trackId`, usadas como base
   * do frame seguinte. Persistido entre frames pelo montador do contexto.
   */
  posicoes: Map<string, { x: number; y: number; tMs: number }>;
}

/**
 * Calcula o movimento das entidades entre o frame atual e as posicoes
 * observadas no frame anterior (`posicoesAnteriores`), com deslocamento e
 * direcao. Entidades sem posicao anterior nao geram movimento.
 */
export function calcularMovimento(
  observacao: ObservacaoFrame,
  posicoesAnteriores: Map<string, { x: number; y: number; tMs: number }>,
  decimais: number
): ResultadoMovimento {
  const movimentos: MovimentoObservado[] = [];
  const posicoes = new Map<string, { x: number; y: number; tMs: number }>();

  const registrar = (
    tipo: MovimentoObservado["tipo"],
    trackId: string,
    centro: { x: number; y: number } | null
  ): void => {
    if (!centro) return;
    const chave = `${tipo}:${trackId}`;
    posicoes.set(chave, { x: centro.x, y: centro.y, tMs: observacao.capturadoEmMs });
    const anterior = posicoesAnteriores.get(chave);
    if (!anterior) return;
    const dx = centro.x - anterior.x;
    const dy = centro.y - anterior.y;
    const intervaloMs = Math.round(observacao.capturadoEmMs - anterior.tMs);
    if (intervaloMs <= 0) return;
    movimentos.push({
      trackId,
      tipo,
      deslocamento: arredondar(Math.hypot(dx, dy), decimais),
      direcaoGraus: Math.round(direcaoGraus(dx, dy)),
      intervaloMs,
    });
  };

  if (!estaIndisponivel(observacao.pose)) {
    for (const pessoa of observacao.pose.pessoas) {
      const trackId = pessoa.entidadeId;
      if (!trackId) continue;
      registrar("pessoa", trackId, centroide(pessoa.pontos));
    }
  }
  if (!estaIndisponivel(observacao.maos)) {
    for (const mao of observacao.maos.maos) {
      const trackId = mao.entidadeId;
      if (!trackId) continue;
      registrar("mao", trackId, centroide(mao.landmarks as PontoCorporal[]));
    }
  }

  return { movimentos, posicoes };
}

/** Centroide dos pontos validos (ou de todos, se nenhum informa confianca). */
export function centroide(pontos: PontoCorporal[]): { x: number; y: number } | null {
  if (!pontos || pontos.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of pontos) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
    if (p.confianca !== undefined && p.confianca < 0.05) continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n };
}

/**
 * Direcao do deslocamento em graus [0, 360), topo = 0, sentido horario. Sem
 * deslocamento, retorna 0 (direcao indeterminada, nao fabricada).
 */
function direcaoGraus(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const angulo = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (angulo + 360) % 360;
}

/** Resultado da validacao das referencias citadas pela interpretacao. */
export interface ReferenciasValidadas {
  /** IDs citados que existem no contexto (frames + eventos). */
  validas: string[];
  /** IDs citados que nao existem em nenhum frame/evento real. */
  invalidas: string[];
}

/** Conjunto de IDs reais (frameIds e eventoIds) do contexto. */
export function idsReais(contexto: ContextoCicloSerializavel): Set<string> {
  const ids = new Set<string>();
  for (const frame of contexto.frames) ids.add(frame.frameId);
  for (const evento of contexto.eventosTemporais) ids.add(evento.eventoId);
  return ids;
}

/**
 * Valida os IDs citados pelo modelo multimodal contra os frames e eventos
 * **reais** do contexto (item 6). Acepta tanto `frameId`/`eventoId` completos
 * quanto o indice 1-based da imagem (`"Imagem 1"`, `"1"`), resolvendo-o para o
 * `frameId` correspondente. Referencias inexistentes sao separadas em
 * `invalidas` (nunca fundidas na lista valida). Mantem a ordem e remove
 * duplicatas.
 */
export function validarReferencias(
  contexto: ContextoCicloSerializavel,
  citados: readonly string[]
): ReferenciasValidadas {
  const reais = idsReais(contexto);
  const porIndice = new Map<number, string>();
  for (const frame of contexto.frames) porIndice.set(frame.indice, frame.frameId);

  const validas: string[] = [];
  const invalidas: string[] = [];
  const vistosValidos = new Set<string>();
  const vistosInvalidos = new Set<string>();

  for (const bruto of citados) {
    if (typeof bruto !== "string" || bruto.trim() === "") continue;
    const referencia = normalizarReferencia(bruto, porIndice);
    if (referencia && reais.has(referencia)) {
      if (!vistosValidos.has(referencia)) {
        vistosValidos.add(referencia);
        validas.push(referencia);
      }
      continue;
    }
    const chave = bruto.trim();
    if (!vistosInvalidos.has(chave)) {
      vistosInvalidos.add(chave);
      invalidas.push(chave);
    }
  }

  return { validas, invalidas };
}

/**
 * Normaliza uma referencia textual do modelo para um `frameId`/`eventoId`:
 * aceita o ID exato, `"Imagem N"`, `"frame N"` ou apenas um indice numerico.
 * Devolve `null` quando nao ha correspondencia.
 */
function normalizarReferencia(
  bruto: string,
  porIndice: Map<number, string>
): string | null {
  const texto = bruto.trim();
  const indice = texto.match(/^(?:imagem|frame)?\s*(\d+)$/i);
  if (indice) {
    const n = Number(indice[1]);
    return porIndice.get(n) ?? null;
  }
  return texto;
}
