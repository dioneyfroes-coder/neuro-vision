import type {
  GeometriaMao,
  GrupoRemovidoContexto,
  MotivoEncerramentoEvento,
  TelemetriaModeloNsfw,
} from "../../../src/domain";

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
 * - estado do subsistema (`ok`/`sem_resultado`/`indisponivel`/`nao_carregado`/
 *   `nao_amostrado`) + motivo, nunca lista vazia indistinguivel de falha;
 * - movimento entre frames (deslocamento/direcao), nao so posicao isolada.
 */

/** Versao do schema. Sobe quando a forma dos campos muda de modo incompativel. */
export const VERSAO_ESQUEMA_CONTEXTO = "contexto-1";

/**
 * Estado observado de um subsistema de percepcao num frame.
 *
 * `nao_amostrado` = pulado de proposito pela cadencia independente: nao e
 * falha nem ausencia, e nao deve ser lido como "nada foi visto".
 */
export type EstadoObservado =
  | "ok"
  | "sem_resultado"
  | "indisponivel"
  | "nao_carregado"
  | "nao_amostrado";

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

/**
 * Keypoints que sustentam postura/gesto e nunca sao descartados na compactacao
 * por bytes: ombros, cotovelos, pulsos e quadris. Membros inferiores/perifericos
 * podem ser podados antes destes (Fase 3, item 3).
 */
export const KEYPOINTS_ESSENCIAIS: readonly string[] = [
  "ombro_esquerdo",
  "ombro_direito",
  "cotovelo_esquerdo",
  "cotovelo_direito",
  "punho_esquerdo",
  "punho_direito",
  "quadril_esquerdo",
  "quadril_direito",
];

/** Caixa normalizada em [0, 1] (relativa as dimensoes do frame). */
export interface CaixaNormalizada {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/**
 * Atencao por proximidade a maos/corpo (Fase 4). Ordena a evidencia; nao muda
 * o grau de certeza da deteccao nem afirma contato.
 */
export interface ProximidadeObjeto {
  /** `mao`/`corpo` quando dentro do raio configurado; `contexto` caso contrario. */
  prioridade: "mao" | "corpo" | "contexto";
  /** Distancia normalizada ate o punho mais proximo, quando ha maos. */
  mao?: number;
  /** Distancia normalizada ate o torso mais proximo, quando ha pose. */
  corpo?: number;
}

/** Resumo de deteccoes compactadas por teto (evidencia reduzida, nao ausencia). */
export interface DeteccoesReduzidas {
  rotulo: string;
  quantidade: number;
  /** Faixas de prioridade presentes no grupo compactado. */
  prioridades: Array<ProximidadeObjeto["prioridade"]>;
  /** IDs rastreados preservados, quando disponiveis. */
  trackIds: string[];
}

/** Deteccao observada pelo detector de objetos. */
export interface DeteccaoObservada {
  /** Rotulo do detector, em portugues quando traduzivel (ex.: `pessoa`). */
  label: string;
  /** Rotulo original do detector (ex.: `person`). */
  rotulo: string;
  score: number;
  caixa: CaixaNormalizada;
  /** ID da instancia rastreada, nao do rotulo/classe do detector. */
  trackId?: string;
  /** Ordem por proximidade a maos/corpo; ausente na variante sem dados locais. */
  proximidade?: ProximidadeObjeto;
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
  /**
   * Track da pessoa a que a mao foi associada por proximidade ao punho. E uma
   * inferencia do motor temporal; ausente quando a associacao e ambigua.
   */
  pessoaTrackId?: string;
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
  /**
   * Geometria derivada dos 21 landmarks: angulos articulares e estado
   * estendido/dobrado por dedo. Independe do gesto predefinido do MediaPipe.
   * Ausente quando os landmarks sao insuficientes para calcular.
   */
  geometria?: GeometriaMao;
}

/** Marcacao NSFW observada (rotulos do proprio modelo, em ingles). */
export interface MarcacaoNsfwObservada {
  rotulo: string;
  score: number;
  caixa: CaixaNormalizada;
  /** Modelo de maior score que produziu a marcacao, quando conhecido. */
  modelo?: string;
  /** Modelos que concordaram com a mesma regiao/rotulo (evidencia somada). */
  modelos?: string[];
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
  /** Telemetria por modelo quando o subsistema agrega um conjunto (NSFW). */
  modelos?: TelemetriaModeloNsfw[];
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
  /** Instante da ultima evidencia positiva (inclusive em evento ativo). */
  ultimaEvidenciaEm?: string;
  /** Instante da ultima observacao valida (pode ser posterior a evidencia). */
  ultimaObservacaoEm?: string;
  /** Ciclo de vida: `candidato`/`confirmado`/`encerrado`/`incerto`. */
  status: string;
  /** Id de entidade associada, quando houver (objeto em `interacao_objeto`). */
  trackId?: string;
  /** Pares de entidades participantes (mão↔objeto em `interacao_objeto`). */
  participantes?: string[];
  confianca?: number;
  /** Frames de evidencia, em ordem cronologica. */
  evidencias: string[];
  /** Lacuna de observacao (ms) que interrompeu o evento, quando houver. */
  gapMs?: number;
  /** Por que o evento terminou (sem sinal, troca, oclusao, periodo cego). */
  motivoEncerramento?: MotivoEncerramentoEvento;
  /** `false` quando a continuidade temporal nao pode ser validada. */
  continuidadeValida?: boolean;
  /**
   * Evidencias textuais do motor (ex.: `geometria:todos`, `velocidadeY:-0.5/s`).
   * Separadas de `evidencias` (IDs de frames) para nao misturar tipos.
   */
  evidenciasTextuais?: string[];
}

/** Grupo de evidencia podado do contexto, com contagem do que saiu. */
export type GrupoTruncamento =
  | "landmarks_mao"
  | "keypoints"
  | "movimento"
  | "evidencias_eventos"
  | "eventos_nao_confirmados"
  | "deteccoes"
  | "deteccoes_reduzidas"
  | "pessoas"
  | "maos";

/** Registro explicito de compactacao do contexto (Fase 3, item 4). */
export interface TruncamentoContexto {
  /** Sempre `true`; a presenca do campo ja indica que houve reducao. */
  ocorreu: true;
  /** Teto aplicado, em bytes UTF-8. */
  maxBytes: number;
  /** Bytes do payload completo antes de qualquer reducao. */
  bytesAntes: number;
  /** Bytes apos as reducoes, medidos antes de incluir este proprio registro. */
  bytesDepois: number;
  /** Grupos removidos/compactados e quantos itens sairam de cada um. */
  gruposRemovidos: GrupoRemovidoContexto[];
  /** `true` quando o payload continuou acima do teto apos todas as reducoes. */
  excedeuTeto: boolean;
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
    /**
     * Soma de tracks vivos (pessoas + maos + objetos). Nao e o numero de
     * entidades fisicas: pose e maos de uma mesma pessoa contam separadamente.
     */
    tracksAtivos: number;
    /** Tracks de pessoas (pose) vivos no fim do ciclo. */
    pessoasAtivas: number;
    /** Tracks de maos vivos no fim do ciclo. */
    maosAtivas: number;
    /** Tracks de objetos vivos no fim do ciclo. */
    objetosAtivos: number;
    houveIntervaloSemObservacao: boolean;
    /** Duracao (ms) do periodo cego anterior ao ciclo, quando houver. */
    intervaloSemObservacaoMs?: number;
  };
  /** Subsistemas indisponiveis (sinalizacao de falha != ausencia). */
  indisponibilidades: string[];
  /**
   * Deteccoes observadas e compactadas por teto, agrupadas por rotulo. Evidencia
   * reduzida: o objeto foi visto, mas os detalhes nao couberam no payload.
   */
  deteccoesReduzidas?: DeteccoesReduzidas[];
  /**
   * Registro explicito de compactacao: presente quando qualquer grupo foi
   * podado, mesmo que o payload final caiba no teto. Ausente quando nada foi
   * removido. `bytesDepois` e medido antes de incluir este proprio registro.
   */
  truncamento?: TruncamentoContexto;
  /**
   * Registro explicito de que o contexto continuou acima do teto mesmo apos
   * todas as reducoes. Ausente quando o payload coube (com ou sem reducoes).
   * `bytes` e medido antes de incluir este proprio registro.
   */
  limiteContexto?: {
    maxBytes: number;
    bytes: number;
    excedeu: true;
  };
}

/** Limites de resolucao/normalizacao usados na montagem do schema. */
export interface OpcoesSerializacao {
  /** Casas decimais para coordenadas/confiancas. */
  decimais: number;
  /** Inclui os 21 landmarks de mao (em vez do subconjunto compacto). */
  landmarksCompletos: boolean;
  /**
   * Inclui a geometria da mao (angulos articulares e dedos estendidos),
   * calculada sobre os 21 landmarks mesmo no modo compacto. Padrao: `true`.
   */
  geometriaMao: boolean;
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
  geometriaMao: true,
  confiancaMinimaKeypoint: 0.3,
  maxKeypointsPorPessoa: 17,
  confiancaMinimaDeteccao: 0,
  maxDeteccoesPorFrame: 20,
  maxPessoasPorFrame: 8,
  maxMaosPorFrame: 8,
};