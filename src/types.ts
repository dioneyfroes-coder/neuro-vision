export interface Caixa {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface ObjetoVisto {
  nome: string;
  rotulo: string;
  score: number;
  caixa: Caixa;
}

export type TipoEntrada = "deteccao" | "descricao";

export interface EntradaLog {
  timestamp: string;
  modelo: string;
  objetos: ObjetoVisto[];
  resumo: string;
  tipo: TipoEntrada;
  snapshot?: string;
  ms?: number;
  tokens?: number;
}
