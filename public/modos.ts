import type { MotorPercepcao } from "../src/percepcao";
import type { DetectorObjetos } from "./detector";
import { MotorDeteccao, MotorVisao } from "./motores";

/**
 * Fase 2 — troca de motor sem espalhar condicoes pela aplicacao.
 *
 * `public/app.ts` coordena estado e interface; cada modo de operacao (o valor do
 * `<select id="motor">`) e descrito aqui por uma `DefinicaoModo`. Adicionar ou
 * trocar um motor significa acrescentar/ajustar uma entrada neste registro — o
 * restante da aplicacao permanece sem `if (modo === "...")` espalhados.
 */

/** Dependencias que a fabrica de motores recebe do app (sem acoplar a UI). */
export interface DependenciasMotor {
  detector: DetectorObjetos;
  modelo: string;
  obterThreshold: () => number;
}

export interface DefinicaoModo {
  /** Identificador (valor do select de motor). */
  id: string;
  /** Precisa do modelo de deteccao carregado no navegador. */
  usaDeteccao: boolean;
  /** Precisa do modelo de visao preparado no servidor. */
  usaVisao: boolean;
  /** "Analisar agora" so se aplica ao fluxo orientado a eventos. */
  permiteAnaliseManual: boolean;
  /** Prefixo da mensagem de falha de inicializacao do motor. */
  falhaPrefixo: string;
  /** Origem do registro operacional quando o motor falha. */
  origemFalha: "detector" | "visao";
  /** Constroi o motor de percepcao correspondente ao modo. */
  criarMotor: (deps: DependenciasMotor) => MotorPercepcao;
}

const criarMotorDeteccao = (deps: DependenciasMotor): MotorPercepcao =>
  new MotorDeteccao({
    detector: deps.detector,
    modelo: deps.modelo,
    obterThreshold: deps.obterThreshold,
  });

const criarMotorVisaoDescricao = (): MotorPercepcao => new MotorVisao({ modo: "descricao" });
const criarMotorVisaoRoteiro = (): MotorPercepcao => new MotorVisao({ modo: "roteiro" });

/** Registro de modos suportados, indexado pelo valor do select de motor. */
export const MODOS: Record<string, DefinicaoModo> = {
  deteccao: {
    id: "deteccao",
    usaDeteccao: true,
    usaVisao: false,
    permiteAnaliseManual: false,
    falhaPrefixo: "Falha ao carregar modelo",
    origemFalha: "detector",
    criarMotor: criarMotorDeteccao,
  },
  visao: {
    id: "visao",
    usaDeteccao: false,
    usaVisao: true,
    permiteAnaliseManual: false,
    falhaPrefixo: "Falha ao preparar o modelo de visao",
    origemFalha: "visao",
    criarMotor: criarMotorVisaoDescricao,
  },
  roteiro: {
    id: "roteiro",
    usaDeteccao: false,
    usaVisao: true,
    permiteAnaliseManual: false,
    falhaPrefixo: "Falha ao preparar o modelo de visao",
    origemFalha: "visao",
    criarMotor: criarMotorVisaoRoteiro,
  },
  eventos: {
    id: "eventos",
    usaDeteccao: true,
    usaVisao: true,
    permiteAnaliseManual: true,
    falhaPrefixo: "Falha ao carregar modelo",
    origemFalha: "detector",
    criarMotor: criarMotorDeteccao,
  },
};

export const MODO_PADRAO = "deteccao";

/** Resolve a definicao de um modo, caindo no padrao para valores desconhecidos. */
export function obterModo(id: string): DefinicaoModo {
  return MODOS[id] ?? MODOS[MODO_PADRAO];
}
