import { ErroPercepcao } from "../../../src/erros";
import { DetectorNsfwOnnx, MODELO_NSFW_CONJUNTO, MODELOS_NSFW_CONJUNTO } from "../../nsfw-onnx";
import type { MotorDeteccao } from "../../yolo-onnx";
import type {
  MetricasAdaptador,
  ClassificadorNsfw,
  EntradaAdaptador,
  OpcoesDeteccao,
} from "../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../contracts";
import type {
  MarcacaoNsfw,
  ResultadoNsfw,
  TelemetriaModeloNsfw,
} from "../../../src/domain/perception";
import { criarMotorNsfwRemoto } from "../workers/motores-remotos";

/**
 * Adaptador do classificador **NSFW experimental** (YOLO treinado para conteudo
 * sensivel, em ONNX) para a porta `ClassificadorNsfw`.
 *
 * Reaproveita o contrato interno `MotorDeteccao` do YOLO COCO — a saida tem o
 * mesmo formato — e converte em `ResultadoNsfw`: rotulos do proprio modelo,
 * caixas em pixels e confianca em [0, 1]. Falha de carga/inferencia propaga como
 * `ErroPercepcao` (o pipeline a converte em `indisponivel`, isolando o frame).
 */
export class AdaptadorClassificadorNsfw implements ClassificadorNsfw {
  readonly id = "nsfw";
  private readonly interno: MotorDeteccao;
  private readonly metricasValor: MetricasAdaptador = {};
  private aoStatusValor?: (mensagem: string) => void;

  /** Aceita um motor falsificado nos testes; em producao usa o NSFW ONNX. */
  constructor(interno: MotorDeteccao = new DetectorNsfwOnnx()) {
    this.interno = interno;
  }

  get modelo(): string | null {
    return this.interno.modelo;
  }

  get metricas(): MetricasAdaptador {
    return this.metricasValor;
  }

  get aoStatus(): ((mensagem: string) => void) | undefined {
    return this.aoStatusValor;
  }

  set aoStatus(fn: ((mensagem: string) => void) | undefined) {
    this.aoStatusValor = fn;
    this.interno.aoStatus = fn;
  }

  async carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void> {
    const inicio = performance.now();
    try {
      await this.interno.carregar(modelo, aoStatus ?? (() => {}));
      this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
      this.metricasValor.memoriaBytes = amostrarMemoriaBytes() ?? this.metricasValor.memoriaBytes;
      this.metricasValor.modelo = this.interno.modelo ?? modelo;
      this.metricasValor.dispositivo = this.interno.dispositivo ?? undefined;
      this.metricasValor.status = "ok";
      this.metricasValor.motivoFalha = undefined;
      this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
    } catch (err) {
      // A falha de carga tambem e telemetria: sem isso o conjunto nao consegue
      // distinguir "modelo nao tentou carregar" de "tentou e falhou".
      this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
      this.metricasValor.modelo = this.interno.modelo ?? modelo;
      this.metricasValor.dispositivo = this.interno.dispositivo ?? undefined;
      this.metricasValor.status = "indisponivel";
      this.metricasValor.motivoFalha = err instanceof Error ? err.message : String(err);
      this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
      throw err;
    }
  }

  avaliar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoNsfw> {
    return medirTempoInferencia(this.metricasValor, async () => {
      try {
        const cru = await this.interno.executar(entrada.imagem, {
          threshold: opcoes?.threshold ?? 0.5,
          percentage: opcoes?.percentage ?? false,
        });
        const marcacoes: MarcacaoNsfw[] = cru.map((d) => ({
          rotulo: d.label,
          score: Number(d.score.toFixed(3)),
          caixa: d.box,
        }));
        const contagem: Record<string, number> = {};
        for (const m of marcacoes) contagem[m.rotulo] = (contagem[m.rotulo] ?? 0) + 1;
        const resumo = marcacoes.length
          ? Object.entries(contagem)
              .map(([rotulo, n]) => (n > 1 ? `${n}x ${rotulo}` : rotulo))
              .join(", ")
          : "nenhuma marcacao";
        this.metricasValor.status = marcacoes.length > 0 ? "ok" : "sem_resultado";
        this.metricasValor.motivoFalha = undefined;
        this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
        return {
          marcacoes,
          modelo: this.interno.modelo ?? undefined,
          resumo,
        };
      } catch (err) {
        this.metricasValor.status = "indisponivel";
        this.metricasValor.motivoFalha = err instanceof Error ? err.message : String(err);
        this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
        throw err;
      }
    });
  }

  /** Libera a sessao do runtime, quando o motor concretor mantiver recursos. */
  encerrar(): void {
    this.interno.encerrar?.();
    this.metricasValor.status = "nao_carregado";
    this.metricasValor.motivoFallback = undefined;
  }
}

/** IoU entre duas caixas no mesmo espaco de coordenadas. */
function iouCaixas(a: MarcacaoNsfw["caixa"], b: MarcacaoNsfw["caixa"]): number {
  const x1 = Math.max(a.xmin, b.xmin);
  const y1 = Math.max(a.ymin, b.ymin);
  const x2 = Math.min(a.xmax, b.xmax);
  const y2 = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
  return inter / (areaA + areaB - inter + 1e-9);
}

/**
 * IoU minimo para considerar que dois modelos marcaram a **mesma regiao**.
 * Abaixo disso sao regioes distintas e ambas permanecem.
 */
export const LIMITE_IOU_MESCLA_NSFW = 0.6;

/**
 * Mescla marcacoes de varios modelos no mesmo frame.
 *
 * Regra: mesmo `rotulo` e caixas com IoU >= `LIMITE_IOU_MESCLA_NSFW` sao a mesma
 * evidencia. Fica a de **maior score** e os modelos que concordaram sao
 * registrados em `modelos` — a evidencia fica mais forte quando dois detectores
 * independentes apontam a mesma regiao. Rotulos diferentes nunca se suprimem:
 * os modelos sao complementares, nao redundantes.
 */
export function mesclarMarcacoesNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfw>
): MarcacaoNsfw[] {
  const ordenadas = [...marcacoes].sort(
    (a, b) => b.score - a.score || a.rotulo.localeCompare(b.rotulo)
  );
  const saida: MarcacaoNsfw[] = [];
  for (const marcacao of ordenadas) {
    const existente = saida.find(
      (m) =>
        m.rotulo === marcacao.rotulo &&
        iouCaixas(m.caixa, marcacao.caixa) >= LIMITE_IOU_MESCLA_NSFW
    );
    if (existente) {
      const modelos = new Set([
        ...(existente.modelos ?? []),
        ...(marcacao.modelos ?? (marcacao.modelo ? [marcacao.modelo] : [])),
      ]);
      existente.modelos = [...modelos];
      continue;
    }
    const modelos = marcacao.modelos ?? (marcacao.modelo ? [marcacao.modelo] : undefined);
    saida.push({ ...marcacao, ...(modelos ? { modelos: [...modelos] } : {}) });
  }
  return saida;
}

/** Fabrica de um adaptador de modelo unico (um worker/thread por modelo). */
export type CriadorAdaptadorNsfw = (modelo: string) => ClassificadorNsfw;

export interface OpcoesConjuntoNsfw {
  /** Modelos a executar; default `MODELOS_NSFW_CONJUNTO`. */
  modelos?: readonly string[];
  /**
   * Fabrica do adaptador de cada modelo. O default cria um
   * `AdaptadorClassificadorNsfw` com `criarMotorNsfwRemoto()` — um worker
   * dedicado por modelo, sem fila/sessao/runtime compartilhados.
   */
  criarAdaptador?: CriadorAdaptadorNsfw;
}

/**
 * Classificador NSFW **multi-modelo**: roda todos os modelos do catalogo no
 * mesmo frame, cada um em seu proprio worker/thread, e mescla as marcacoes.
 *
 * - Carga em paralelo; um modelo que falha nao derruba os demais. O subsistema
 *   so fica indisponivel quando **todos** falham.
 * - Avaliacao em paralelo sobre a mesma entrada; o tempo medido e o da parede
 *   (o mais lento manda), e cada modelo mantem sua propria telemetria.
 * - O resultado e complementar: rotulos diferentes somam; a mesma regiao com o
 *   mesmo rotulo e deduplicada por IoU e ganha a lista de modelos concordantes.
 */
export class AdaptadorNsfwConjunto implements ClassificadorNsfw {
  readonly id = "nsfw";
  private readonly adaptadores = new Map<string, ClassificadorNsfw>();
  private readonly modelosAlvo: readonly string[];
  private readonly criarAdaptador: CriadorAdaptadorNsfw;
  private readonly metricasValor: MetricasAdaptador = {};
  private aoStatusValor?: (mensagem: string) => void;
  private carregado = false;

  constructor(opcoes: OpcoesConjuntoNsfw = {}) {
    this.modelosAlvo = opcoes.modelos ?? MODELOS_NSFW_CONJUNTO;
    this.criarAdaptador =
      opcoes.criarAdaptador ??
      (() => new AdaptadorClassificadorNsfw(criarMotorNsfwRemoto()));
  }

  get modelo(): string | null {
    return this.carregado ? MODELO_NSFW_CONJUNTO : null;
  }

  get metricas(): MetricasAdaptador {
    return this.metricasValor;
  }

  get aoStatus(): ((mensagem: string) => void) | undefined {
    return this.aoStatusValor;
  }

  set aoStatus(fn: ((mensagem: string) => void) | undefined) {
    this.aoStatusValor = fn;
    for (const adaptador of this.adaptadores.values()) adaptador.aoStatus = fn;
  }

  async carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void> {
    // `modelo` e o id composto que ativa o conjunto; a lista efetiva vem do
    // catalogo. Um id de modelo unico continua aceito para diagnostico, mas o
    // comportamento padrao e carregar todos (sem seletor na interface).
    void modelo;
    const inicio = performance.now();
    if (aoStatus) this.aoStatusValor = aoStatus;
    for (const id of this.modelosAlvo) {
      if (!this.adaptadores.has(id)) {
        const adaptador = this.criarAdaptador(id);
        adaptador.aoStatus = this.aoStatusValor;
        this.adaptadores.set(id, adaptador);
      }
    }

    const ids = [...this.adaptadores.keys()];
    const resultados = await Promise.allSettled(
      ids.map((id) => this.adaptadores.get(id)!.carregar(id, this.aoStatusValor))
    );

    const carregados: string[] = [];
    const falhas: string[] = [];
    resultados.forEach((resultado, indice) => {
      const id = ids[indice];
      if (resultado.status === "fulfilled") carregados.push(id);
      else {
        const motivo =
          resultado.reason instanceof Error
            ? resultado.reason.message
            : String(resultado.reason);
        falhas.push(`${id}: ${motivo}`);
      }
    });

    this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
    this.metricasValor.memoriaBytes = amostrarMemoriaBytes() ?? this.metricasValor.memoriaBytes;
    this.metricasValor.modelos = carregados;
    this.metricasValor.telemetriaModelos = this.montarTelemetria();
    this.metricasValor.motivoFallback = this.motivosFallback();
    this.metricasValor.dispositivo = this.dispositivoComum(carregados);
    this.carregado = carregados.length > 0;
    if (!this.carregado) {
      this.metricasValor.modelo = undefined;
      this.metricasValor.status = "indisponivel";
      this.metricasValor.motivoFalha = `nenhum modelo NSFW carregou: ${falhas.join("; ")}`;
      throw new ErroPercepcao("detector", this.metricasValor.motivoFalha);
    }
    this.metricasValor.modelo = MODELO_NSFW_CONJUNTO;
    this.metricasValor.status = "ok";
    this.metricasValor.motivoFalha = falhas.length ? falhas.join("; ") : undefined;
  }

  async avaliar(
    entrada: EntradaAdaptador,
    opcoes?: OpcoesDeteccao
  ): Promise<ResultadoNsfw> {
    if (!this.carregado || this.adaptadores.size === 0) {
      throw new ErroPercepcao("detector", "Conjunto NSFW nao carregado.");
    }
    const inicio = performance.now();
    const ids = [...this.adaptadores.keys()];
    const resultados = await Promise.allSettled(
      ids.map((id) => this.adaptadores.get(id)!.avaliar(entrada, opcoes))
    );

    const brutas: MarcacaoNsfw[] = [];
    const validos: string[] = [];
    const falhas: string[] = [];
    const contagemPorModelo = new Map<string, number>();
    resultados.forEach((resultado, indice) => {
      const id = ids[indice];
      if (resultado.status === "fulfilled") {
        validos.push(id);
        contagemPorModelo.set(id, resultado.value.marcacoes.length);
        for (const marcacao of resultado.value.marcacoes) {
          brutas.push({
            ...marcacao,
            modelo: resultado.value.modelo ?? id,
            modelos: [resultado.value.modelo ?? id],
          });
        }
      } else {
        contagemPorModelo.set(id, 0);
        falhas.push(
          `${id}: ${resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason)}`
        );
      }
    });

    const tempoInferenciaMs = Math.round(performance.now() - inicio);
    this.metricasValor.tempoInferenciaMs = tempoInferenciaMs;
    this.metricasValor.memoriaBytes = amostrarMemoriaBytes() ?? this.metricasValor.memoriaBytes;
    this.metricasValor.telemetriaModelos = this.montarTelemetria(contagemPorModelo);
    this.metricasValor.motivoFallback = this.motivosFallback();

    if (validos.length === 0) {
      this.metricasValor.status = "indisponivel";
      this.metricasValor.motivoFalha = `nenhum modelo NSFW respondeu: ${falhas.join("; ")}`;
      throw new ErroPercepcao("detector", this.metricasValor.motivoFalha);
    }

    const marcacoes = mesclarMarcacoesNsfw(brutas);
    this.metricasValor.status = marcacoes.length > 0 ? "ok" : "sem_resultado";
    this.metricasValor.motivoFalha = falhas.length ? falhas.join("; ") : undefined;

    const contagem: Record<string, number> = {};
    for (const marcacao of marcacoes) {
      contagem[marcacao.rotulo] = (contagem[marcacao.rotulo] ?? 0) + 1;
    }
    const resumo = marcacoes.length
      ? Object.entries(contagem)
          .map(([rotulo, n]) => (n > 1 ? `${n}x ${rotulo}` : rotulo))
          .join(", ")
      : "nenhuma marcacao";

    return {
      marcacoes,
      modelo: MODELO_NSFW_CONJUNTO,
      modelos: validos,
      resumo,
    };
  }

  /** Libera todos os modelos (cada um encerra seu worker/sessao). */
  encerrar(): void {
    for (const adaptador of this.adaptadores.values()) adaptador.encerrar();
    this.adaptadores.clear();
    this.carregado = false;
    this.metricasValor.status = "nao_carregado";
    this.metricasValor.modelo = undefined;
    this.metricasValor.modelos = [];
    this.metricasValor.telemetriaModelos = [];
    this.metricasValor.motivoFallback = undefined;
  }

  /** Motivos de fallback por modelo, agregados para o subsistema. */
  private motivosFallback(): string | undefined {
    const motivos = (this.metricasValor.telemetriaModelos ?? [])
      .filter((t) => t.motivoFallback)
      .map((t) => `${t.modelo}: ${t.motivoFallback}`);
    return motivos.length ? motivos.join("; ") : undefined;
  }

  /** Dispositivo comum aos modelos carregados, ou `misto` quando divergem. */
  private dispositivoComum(carregados: readonly string[]): string | undefined {
    const dispositivos = new Set(
      carregados
        .map((id) => this.adaptadores.get(id)?.metricas.dispositivo)
        .filter((d): d is string => Boolean(d))
    );
    if (dispositivos.size === 0) return undefined;
    return dispositivos.size === 1 ? [...dispositivos][0] : "misto";
  }

  /**
   * Telemetria por modelo. `contagem` (opcional) adiciona o numero de marcacoes
   * da ultima avaliacao; sem ela, o campo fica ausente (nao medido).
   */
  private montarTelemetria(
    contagem?: ReadonlyMap<string, number>
  ): TelemetriaModeloNsfw[] {
    return [...this.adaptadores.entries()].map(([id, adaptador]) => {
      const metricas = adaptador.metricas;
      const marcacoes = contagem?.get(id);
      return {
        modelo: id,
        status: metricas.status ?? "nao_carregado",
        ...(metricas.dispositivo ? { dispositivo: metricas.dispositivo } : {}),
        ...(metricas.motivoFalha ? { motivoFalha: metricas.motivoFalha } : {}),
        ...(metricas.motivoFallback ? { motivoFallback: metricas.motivoFallback } : {}),
        ...(metricas.tempoCargaMs !== undefined
          ? { tempoCargaMs: metricas.tempoCargaMs }
          : {}),
        ...(metricas.tempoInferenciaMs !== undefined
          ? { tempoInferenciaMs: metricas.tempoInferenciaMs }
          : {}),
        ...(metricas.memoriaBytes !== undefined
          ? { memoriaBytes: metricas.memoriaBytes }
          : {}),
        ...(marcacoes !== undefined ? { marcacoes } : {}),
      };
    });
  }
}
