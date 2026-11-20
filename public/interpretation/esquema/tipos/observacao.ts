import type { GeometriaMao, TelemetriaModeloNsfw } from "../../../../src/domain";

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
