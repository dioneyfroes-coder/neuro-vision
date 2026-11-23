import { ErroPercepcao } from "../../../../src/erros";
import { MODELO_NSFW_CONJUNTO, MODELOS_NSFW_CONJUNTO } from "../../../nsfw-onnx";
import type { ClassificadorNsfw, EntradaAdaptador, MetricasAdaptador, OpcoesDeteccao } from "../../contracts";
import { amostrarMemoriaBytes } from "../../contracts";
import type { MarcacaoNsfw, ResultadoNsfw, TelemetriaModeloNsfw } from "../../../../src/domain/perception";
import { criarMotorNsfwRemoto } from "../../workers/motores-remotos";
import { AdaptadorClassificadorNsfw } from "./adapter-unitario";
import { mesclarMarcacoesNsfw } from "./mesclagem";

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
  /**
   * Apenas os modelos que concluiram a carga. `adaptadores` continua com todos
   * (inclusive os indisponiveis) para preservar a telemetria e permitir retry;
   * `avaliar()` nao deve chamar um modelo que ja falhou na carga.
   */
  private readonly modelosCarregados = new Set<string>();
  /**
   * Falhas de carga persistem ate um retry explicito. Sem isso, a proxima
   * inferencia bem-sucedida apagava o motivo do modelo indisponivel do
   * diagnostico agregado.
   */
  private falhasCarga: string[] = [];
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

    // Cada chamada a `carregar()` e um retry explicito: os adaptadores ja
    // existentes sao reaproveitados (sem duplicar workers) e os que falharam
    // antes sao tentados de novo. Nada e reexecutado automaticamente por frame.
    try {
      for (const id of this.modelosAlvo) {
        if (!this.adaptadores.has(id)) {
          const adaptador = this.criarAdaptador(id);
          adaptador.aoStatus = this.aoStatusValor;
          this.adaptadores.set(id, adaptador);
        }
      }
    } catch (erro) {
      // Se a fabrica falhar no meio do conjunto, libera os adaptadores ja
      // criados em vez de deixar workers orfaos.
      this.encerrar();
      throw erro instanceof Error
        ? erro
        : new ErroPercepcao("detector", `Falha ao criar conjunto NSFW: ${String(erro)}`);
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

    this.modelosCarregados.clear();
    for (const id of carregados) this.modelosCarregados.add(id);
    this.falhasCarga = falhas;

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
    const ids = [...this.modelosCarregados];
    if (!this.carregado || ids.length === 0) {
      throw new ErroPercepcao("detector", "Conjunto NSFW nao carregado.");
    }
    const inicio = performance.now();
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
    this.metricasValor.motivoFalha = this.motivosFalhaAgregados(falhas);

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

  /** Falhas de carga e de inferencia do ultimo frame, sem duplicar motivos. */
  private motivosFalhaAgregados(falhasInferencia: readonly string[]): string | undefined {
    const motivos = [...new Set([...this.falhasCarga, ...falhasInferencia])];
    return motivos.length ? motivos.join("; ") : undefined;
  }

  /**
   * Libera todos os modelos, inclusive os que falharam na carga ou que nunca
   * chegaram a ser usados. Idempotente: limpa o mapa antes de encerrar, de modo
   * que uma segunda chamada nao tente liberar o mesmo worker duas vezes. Um
   * adaptador que lance no descarte nao impede a liberacao dos demais.
   */
  encerrar(): void {
    const adaptadores = [...this.adaptadores.values()];
    this.adaptadores.clear();
    this.modelosCarregados.clear();
    this.falhasCarga = [];
    this.carregado = false;
    this.metricasValor.status = "nao_carregado";
    this.metricasValor.modelo = undefined;
    this.metricasValor.modelos = [];
    this.metricasValor.telemetriaModelos = [];
    this.metricasValor.motivoFallback = undefined;
    this.metricasValor.motivoFalha = undefined;
    for (const adaptador of adaptadores) {
      try {
        adaptador.encerrar();
      } catch {
        // O descarte e best-effort por adaptador; os demais ainda devem ser
        // encerrados e o estado agregado ja foi limpo acima.
      }
    }
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
