import {
  calcularGeometriaMao,
  estaIndisponivel,
  naoFoiAmostrado,
  type Caixa,
  type PessoaPose,
  type PontoCorporal,
  type ResultadoDeteccaoLocal,
  type ResultadoMaos,
  type ResultadoNsfw,
  type ResultadoOuIndisponivel,
  type ResultadoPose,
  type TelemetriaModeloNsfw,
} from "../../../src/domain";
import {
  CaixaNormalizada,
  DeteccaoObservada,
  EstadoObservado,
  EstadoSubsistemaObservado,
  KeypointNomeado,
  MaoObservada,
  MarcacaoNsfwObservada,
  NOMES_KEYPOINTS_COCO,
  OpcoesSerializacao,
  PessoaObservada,
} from "./tipos";

const LANDMARKS_MAO_COMPACTOS: Array<{ indice: number; nome: string }> = [
  { indice: 0, nome: "punho" },
  { indice: 4, nome: "polegar_ponta" },
  { indice: 8, nome: "indicador_ponta" },
  { indice: 12, nome: "medio_ponta" },
  { indice: 16, nome: "anular_ponta" },
  { indice: 20, nome: "mindinho_ponta" },
];

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
  telemetria:
    | {
        status?: EstadoObservado;
        modelo?: string;
        motivoFalha?: string;
        modelos?: TelemetriaModeloNsfw[];
      }
    | undefined,
  vazio: (valor: T) => boolean
): EstadoSubsistemaObservado {
  const modelos = telemetria?.modelos?.length ? { modelos: telemetria.modelos } : {};
  if (resultado === undefined) {
    return {
      status: telemetria?.status ?? "nao_carregado",
      modelo: telemetria?.modelo,
      motivo: telemetria?.motivoFalha,
      ...modelos,
    };
  }
  if (estaIndisponivel(resultado)) {
    if (naoFoiAmostrado(resultado)) {
      return {
        status: "nao_amostrado",
        modelo: telemetria?.modelo,
        motivo: resultado.motivo,
        ...modelos,
      };
    }
    return {
      status: "indisponivel",
      modelo: telemetria?.modelo,
      motivo: resultado.motivo,
      ...modelos,
    };
  }
  const status: EstadoObservado = vazio(resultado) ? "sem_resultado" : "ok";
  return {
    status,
    modelo: telemetria?.modelo ?? (resultado as { modelo?: string }).modelo,
    ...modelos,
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
      ...(d.entidadeId ? { trackId: d.entidadeId } : {}),
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
  opcoes: OpcoesSerializacao,
  dimensoesFrame?: { largura: number; altura: number }
): MaoObservada[] {
  if (estaIndisponivel(resultado)) return [];
  const dimensoes = resultado.dimensoes ?? dimensoesFrame;
  return resultado.maos.slice(0, opcoes.maxMaosPorFrame).map((mao, i) => {
    const observada: MaoObservada = {
      indice: i + 1,
      lateralidade: mao.lateralidade,
      landmarks: serializarLandmarksMao(mao.landmarks, opcoes),
      landmarksCompletos: opcoes.landmarksCompletos,
    };
    if (mao.entidadeId) observada.trackId = mao.entidadeId;
    if (mao.pessoaEntidadeId) observada.pessoaTrackId = mao.pessoaEntidadeId;
    if (mao.gesto) {
      observada.gesto = {
        nome: mao.gesto.nome,
        confianca: arredondar(limitar01(mao.gesto.confianca), opcoes.decimais),
      };
    }
    if (opcoes.geometriaMao) {
      const geometria = calcularGeometriaMao(mao.landmarks, {
        decimais: opcoes.decimais,
        dimensoes,
      });
      if (geometria) observada.geometria = geometria;
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
    ...(m.modelo ? { modelo: m.modelo } : {}),
    ...(m.modelos?.length ? { modelos: [...m.modelos] } : {}),
  }));
}