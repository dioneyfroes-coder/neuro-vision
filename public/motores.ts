import type {
  EntradaPercepcao,
  MotorPercepcao,
  ResultadoPercepcao,
} from "../src/percepcao";
import type { MotivoAnalise } from "../src/types";
import type { DetectorObjetos } from "./perception/contracts";
import * as api from "./api";
import type { PayloadVisao } from "./api";

export interface OpcoesMotorDeteccao {
  detector: DetectorObjetos;
  modelo: string;
  /** Limiar lido a cada analise, para refletir ajustes da interface. */
  obterThreshold: () => number;
}

/** Motor de deteccao de objetos (Transformers.js), atras da interface comum. */
export class MotorDeteccao implements MotorPercepcao {
  readonly id = "deteccao";

  constructor(private readonly opcoes: OpcoesMotorDeteccao) {}

  async inicializar(aoStatus: (mensagem: string) => void = () => {}): Promise<void> {
    await this.opcoes.detector.carregar(this.opcoes.modelo, aoStatus);
  }

  async analisar(entrada: EntradaPercepcao, _sinal?: AbortSignal): Promise<ResultadoPercepcao> {
    const inicio = performance.now();
    const resultado = await this.opcoes.detector.detectar(
      { imagem: entrada.imagem, dimensoes: entrada.dimensoes },
      { threshold: this.opcoes.obterThreshold(), percentage: false }
    );
    return {
      modelo: resultado.modelo ?? this.opcoes.detector.modelo ?? "desconhecido",
      duracaoMs: Math.round(performance.now() - inicio),
      objetos: resultado.deteccoes,
      descricao: resultado.resumo ?? "",
      snapshot: entrada.snapshot,
      capturadoEm: entrada.capturadoEm,
    };
  }

  encerrar(): void {
    // O detector permanece em cache para reutilizacao entre sessoes.
  }
}

export interface OpcoesMotorVisao {
  modo: "roteiro" | "descricao";
  /** Id do modelo de visao no backend; sem ele vale o configurado no servidor. */
  modelo?: string;
  /** Roteiro acumulado (modo roteiro). */
  roteiro?: string;
  /** Primeiro frame do roteiro (analise profunda). */
  base?: boolean;
  /** Descricao anterior (modo descricao). */
  anterior?: string;
  /** Razao que acionou esta analise (fluxo orientado a eventos). */
  motivo?: MotivoAnalise;
}

/** Motor de descricao/roteiro via backend de visao, atras da interface comum. */
export class MotorVisao implements MotorPercepcao {
  readonly id: string;

  constructor(private readonly opcoes: OpcoesMotorVisao) {
    this.id = opcoes.modo === "roteiro" ? "roteiro" : "visao";
  }

  async inicializar(aoStatus: (mensagem: string) => void = () => {}): Promise<void> {
    aoStatus("Carregando modelo de visao na memoria (pode demorar)...");
    const dados = await api.prepararVisao(this.opcoes.modelo);
    if (dados.carregado !== true) {
      throw new Error("modelo nao confirmado em memoria; verifique o servidor de visao.");
    }
    const seg = Math.round((dados.carregandoMs ?? 0) / 1000);
    aoStatus(
      `Modelo ${dados.modelo ?? ""} carregado${seg > 0 ? ` em ${seg}s` : " (ja estava em memoria)"}. Pronto!`
    );
  }

  async analisar(
    entrada: EntradaPercepcao,
    sinal: AbortSignal,
    aoProgresso?: (parcial: string) => void
  ): Promise<ResultadoPercepcao | null> {
    const inicio = performance.now();
    const payload: PayloadVisao = { imagem: entrada.imagem, snapshot: entrada.snapshot };
    if (this.opcoes.modelo) payload.modelo = this.opcoes.modelo;
    if (this.opcoes.modo === "roteiro") {
      payload.modo = "roteiro";
      payload.roteiro = this.opcoes.roteiro;
      payload.base = this.opcoes.base;
    } else {
      payload.anterior = this.opcoes.anterior;
    }
    payload.motivo = this.opcoes.motivo;

    const { evento, parcial } = await api.descreverFrame(payload, sinal, aoProgresso);
    const descricao = evento?.descricao ?? parcial;
    return {
      modelo: evento?.modelo ?? "visao",
      duracaoMs: Math.round(performance.now() - inicio),
      objetos: [],
      descricao,
      snapshot: evento?.snapshot,
      capturadoEm: entrada.capturadoEm,
      confianca: {
        tokens: evento?.tokens,
        papel: evento?.papel,
        semMudanca: evento?.semMudanca,
      },
    };
  }

  encerrar(): void {
    // Nada a liberar no cliente; o modelo vive no servidor.
  }
}
