import type { MaoDetectada, PessoaPose, PontoCorporal } from "../../src/domain";

/**
 * Regras geometricas de **pose compativel** com ato sexual (Fase 7.2).
 *
 * Estas regras NAO detectam ato sexual e nunca devem ser tratadas como prova.
 * Elas apenas acumulam indicios visuais que o motor temporal pode emitir como
 * `pose_compativel_sexual`:
 *
 * - mao/punho proximo da regiao genital por varios frames;
 * - pernas/joelhos afastados em relacao a largura do quadril;
 * - movimento ritmico (inversoes de direcao) do punho ao longo dos frames.
 *
 * O modulo e puro e deterministico: sem browser, sem modelo, sem inferencia. A
 * confianca e uma soma ponderada de regras atendidas, limitada a 1; o evento
 * resultante continua sendo "indicio", nao veredito.
 */

/** Indices COCO (17 pontos) usados pelas regras. */
const PUNHOS = [9, 10] as const;
const QUADRIS = [11, 12] as const;
const JOELHOS = [13, 14] as const;
const TORNOZELOS = [15, 16] as const;

/** Nome estavel de cada regra geometrica. */
export type RegraPoseSexual =
  | "mao_proxima_genital"
  | "pernas_abertas"
  | "movimento_ritmico_punho";

/** Configuracao das regras geometricas. */
export interface ConfigRegrasPoseSexual {
  /** Confianca minima de cada ponto para entrar na regra. */
  confiancaMinimaPonto: number;
  /**
   * Distancia normalizada maxima entre mao/punho e a regiao genital estimada.
   * A regiao tambem aceita um raio proporcional a largura do quadril.
   */
  distanciaMaoGenital: number;
  /**
   * Razao minima entre a distancia dos joelhos (ou tornozelos) e a largura do
   * quadril para contar como "pernas abertas".
   */
  proporcaoPernasAbertas: number;
  /** Amostras de punho mantidas por lado para medir ritmo. */
  janelaRitmo: number;
  /** Amplitude normalizada minima (peak-to-peak) para considerar ritmo. */
  amplitudeRitmo: number;
  /** Inversoes de direcao necessarias para considerar movimento ritmico. */
  inversoesRitmo: number;
  /** Peso da mao proxima da genital no score final. */
  pesoMaoGenital: number;
  /** Peso das pernas abertas no score final. */
  pesoPernasAbertas: number;
  /** Peso do movimento ritmico no score final. */
  pesoRitmo: number;
  /** Score minimo para marcar a pose como compativel. */
  limiarCompativel: number;
}

export const CONFIG_REGRAS_POSE_SEXUAL_PADRAO: ConfigRegrasPoseSexual = {
  confiancaMinimaPonto: 0.5,
  distanciaMaoGenital: 0.12,
  proporcaoPernasAbertas: 1.2,
  janelaRitmo: 6,
  amplitudeRitmo: 0.03,
  inversoesRitmo: 2,
  pesoMaoGenital: 0.5,
  pesoPernasAbertas: 0.25,
  pesoRitmo: 0.25,
  limiarCompativel: 0.5,
};

/** Resultado da avaliacao de um frame para uma pessoa. */
export interface ResultadoRegraPose {
  /** Ha indicio geometrico suficiente (score >= limiar). */
  compativel: boolean;
  /** Score em [0, 1]; soma ponderada das regras atendidas. */
  confianca: number;
  /** Regras atendidas neste frame. */
  regras: RegraPoseSexual[];
  /** Evidencias textuais (regra + medidas) para o evento/prompt. */
  evidencias: string[];
}

interface RegiaoGenital {
  x: number;
  y: number;
  larguraQuadril: number;
}

interface AmostraPunho {
  x: number;
  y: number;
  tempoMs: number;
}

/**
 * Avaliador com estado apenas para o ritmo do punho. O restante e por frame.
 *
 * O estado e limpo por sessao (`limpar()`); a janela e curta e cada lado do
 * corpo tem seu proprio historico.
 */
export class AvaliadorPoseSexual {
  private readonly config: ConfigRegrasPoseSexual;
  private readonly historico = new Map<string, AmostraPunho[]>();

  constructor(config?: Partial<ConfigRegrasPoseSexual>) {
    this.config = { ...CONFIG_REGRAS_POSE_SEXUAL_PADRAO, ...config };
  }

  limpar(): void {
    this.historico.clear();
  }

  /**
   * Avalia uma pessoa no frame. `maos` sao as maos detectadas no mesmo frame
   * (o rastreador ainda nao associa mao a pessoa; a regra usa a distancia
   * geometrica e por isso permanece um indicio fraco).
   */
  avaliar(
    pose: PessoaPose,
    maos: ReadonlyArray<MaoDetectada>,
    tempoMs: number
  ): ResultadoRegraPose {
    const regiao = this.regiaoGenital(pose.pontos);
    const regras: RegraPoseSexual[] = [];
    const evidencias: string[] = [];

    if (regiao) {
      const distanciaMao = this.menorDistanciaMaoGenital(pose, maos, regiao);
      if (distanciaMao !== null) {
        regras.push("mao_proxima_genital");
        evidencias.push(
          `mao_proxima_genital:dist=${arredondar(distanciaMao)};` +
            `limiar=${arredondar(this.config.distanciaMaoGenital)}`
        );
      }

      const pernas = this.pernasAbertas(pose.pontos, regiao);
      if (pernas !== null) {
        regras.push("pernas_abertas");
        evidencias.push(
          `pernas_abertas:${pernas.referencia}=${arredondar(pernas.distancia)};` +
            `quadril=${arredondar(regiao.larguraQuadril)};` +
            `razao=${arredondar(pernas.razao)}`
        );
      }
    }

    const ritmo = this.ritmoPunho(pose, tempoMs);
    if (ritmo) {
      regras.push("movimento_ritmico_punho");
      evidencias.push(
        `movimento_ritmico_punho:eixo=${ritmo.eixo};` +
          `inversoes=${ritmo.inversoes};amplitude=${arredondar(ritmo.amplitude)}`
      );
    }

    const score = this.score(regras);
    return {
      compativel: score >= this.config.limiarCompativel,
      confianca: score,
      regras,
      evidencias:
        regras.length > 0
          ? [...evidencias, `score=${arredondar(score)}`]
          : ["pose:sem_regra"],
    };
  }

  private score(regras: ReadonlyArray<RegraPoseSexual>): number {
    let score = 0;
    if (regras.includes("mao_proxima_genital")) score += this.config.pesoMaoGenital;
    if (regras.includes("pernas_abertas")) score += this.config.pesoPernasAbertas;
    if (regras.includes("movimento_ritmico_punho")) score += this.config.pesoRitmo;
    return Math.min(1, Math.max(0, score));
  }

  /**
   * Regiao genital estimada a partir dos quadris. Sem os dois quadris
   * confiaveis nao ha regiao: nao adivinhamos anatomia a partir de ombros.
   */
  private regiaoGenital(pontos: ReadonlyArray<PontoCorporal>): RegiaoGenital | null {
    const esquerdo = pontoConfiavel(pontos[QUADRIS[0]], this.config.confiancaMinimaPonto);
    const direito = pontoConfiavel(pontos[QUADRIS[1]], this.config.confiancaMinimaPonto);
    if (!esquerdo || !direito) return null;
    const larguraQuadril = Math.max(0.02, Math.hypot(direito.x - esquerdo.x, direito.y - esquerdo.y));
    return {
      x: (esquerdo.x + direito.x) / 2,
      // A genital fica abaixo da linha do quadril; o deslocamento e proporcional
      // a largura para nao depender da escala da pessoa no enquadramento.
      y: (esquerdo.y + direito.y) / 2 + larguraQuadril * 0.35,
      larguraQuadril,
    };
  }

  /**
   * Menor distancia entre punhos/centroides de mao e a regiao genital.
   *
   * O raio aceito combina o limiar absoluto com um raio proporcional ao quadril:
   * pessoas maiores no enquadramento nao ficam penalizadas.
   */
  private menorDistanciaMaoGenital(
    pose: PessoaPose,
    maos: ReadonlyArray<MaoDetectada>,
    regiao: RegiaoGenital
  ): number | null {
    const raio = Math.max(this.config.distanciaMaoGenital, regiao.larguraQuadril * 0.75);
    let menor: number | null = null;
    for (const indice of PUNHOS) {
      const punho = pontoConfiavel(pose.pontos[indice], this.config.confiancaMinimaPonto);
      if (!punho) continue;
      const distancia = Math.hypot(punho.x - regiao.x, punho.y - regiao.y);
      if (distancia <= raio && (menor === null || distancia < menor)) menor = distancia;
    }
    for (const mao of maos) {
      const centro = centroideMao(mao);
      if (!centro) continue;
      const distancia = Math.hypot(centro.x - regiao.x, centro.y - regiao.y);
      if (distancia <= raio && (menor === null || distancia < menor)) menor = distancia;
    }
    return menor;
  }

  /**
   * Pernas abertas: joelhos (preferencial) ou tornozelos afastados em relacao a
   * largura do quadril. Exige que os pontos estejam abaixo dos quadris, para
   * nao confundir bracos com pernas.
   */
  private pernasAbertas(
    pontos: ReadonlyArray<PontoCorporal>,
    regiao: RegiaoGenital
  ): { distancia: number; razao: number; referencia: string } | null {
    const quadrilEsq = pontoConfiavel(pontos[QUADRIS[0]], this.config.confiancaMinimaPonto);
    const quadrilDir = pontoConfiavel(pontos[QUADRIS[1]], this.config.confiancaMinimaPonto);
    const quadrilY = quadrilEsq && quadrilDir ? (quadrilEsq.y + quadrilDir.y) / 2 : null;
    if (quadrilY === null) return null;

    for (const [nome, indices] of [
      ["joelhos", JOELHOS],
      ["tornozelos", TORNOZELOS],
    ] as const) {
      const esquerdo = pontoConfiavel(pontos[indices[0]], this.config.confiancaMinimaPonto);
      const direito = pontoConfiavel(pontos[indices[1]], this.config.confiancaMinimaPonto);
      if (!esquerdo || !direito) continue;
      if (esquerdo.y <= quadrilY || direito.y <= quadrilY) continue;
      const distancia = Math.hypot(direito.x - esquerdo.x, direito.y - esquerdo.y);
      const razao = distancia / regiao.larguraQuadril;
      if (razao >= this.config.proporcaoPernasAbertas) {
        return { distancia, razao, referencia: nome };
      }
    }
    return null;
  }

  /**
   * Ritmo do punho: inversoes de direcao em uma janela curta de amostras.
   *
   * Cada lado tem seu historico. O eixo com mais inversoes vence; a amplitude
   * peak-to-peak precisa passar do minimo para nao tratar tremor/ruido como
   * movimento ritmico.
   */
  private ritmoPunho(
    pose: PessoaPose,
    tempoMs: number
  ): { eixo: "x" | "y"; inversoes: number; amplitude: number } | null {
    const chaveBase = pose.entidadeId ?? "sem-track";
    let melhor: { eixo: "x" | "y"; inversoes: number; amplitude: number } | null = null;
    for (const indice of PUNHOS) {
      const punho = pontoConfiavel(pose.pontos[indice], this.config.confiancaMinimaPonto);
      if (!punho) continue;
      const chave = `${chaveBase}:${indice}`;
      const amostras = this.historico.get(chave) ?? [];
      amostras.push({ x: punho.x, y: punho.y, tempoMs });
      while (amostras.length > this.config.janelaRitmo) amostras.shift();
      this.historico.set(chave, amostras);
      if (amostras.length < 4) continue;

      for (const eixo of ["x", "y"] as const) {
        const valores = amostras.map((a) => a[eixo]);
        const amplitude = Math.max(...valores) - Math.min(...valores);
        if (amplitude < this.config.amplitudeRitmo) continue;
        const inversoes = contarInversoes(valores, this.config.amplitudeRitmo / 4);
        if (inversoes < this.config.inversoesRitmo) continue;
        if (!melhor || inversoes > melhor.inversoes) {
          melhor = { eixo, inversoes, amplitude };
        }
      }
    }
    return melhor;
  }
}

/** Conta mudancas de sinal entre deltas acima de `ruido`. */
function contarInversoes(valores: ReadonlyArray<number>, ruido: number): number {
  let anterior = 0;
  let inversoes = 0;
  for (let i = 1; i < valores.length; i += 1) {
    const delta = valores[i] - valores[i - 1];
    if (Math.abs(delta) < ruido) continue;
    const sinal = Math.sign(delta);
    if (anterior !== 0 && sinal !== anterior) inversoes += 1;
    anterior = sinal;
  }
  return inversoes;
}

function centroideMao(mao: MaoDetectada): { x: number; y: number } | null {
  const validos = mao.landmarks.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  if (validos.length === 0) return null;
  return {
    x: validos.reduce((soma, p) => soma + p.x, 0) / validos.length,
    y: validos.reduce((soma, p) => soma + p.y, 0) / validos.length,
  };
}

function pontoConfiavel(
  ponto: PontoCorporal | undefined,
  confiancaMinima: number
): PontoCorporal | null {
  if (!ponto || !Number.isFinite(ponto.x) || !Number.isFinite(ponto.y)) return null;
  if (ponto.confianca !== undefined && ponto.confianca < confiancaMinima) return null;
  return ponto;
}

function arredondar(valor: number, decimais = 3): number {
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}
