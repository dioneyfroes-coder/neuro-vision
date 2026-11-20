import type { ProcessamentoFrame } from "../../../public/cycle/ciclo-multiframe";
import type { DefinicaoModo } from "../../../public/modos";
import { VARIANTES_PERCEPCAO } from "../../../public/perception/variantes";
import { CONFIG_CAPTURA_PADRAO } from "../../../public/capture/webcam-capture";

export const MODO: DefinicaoModo = {
  id: "percepcao",
  usaDeteccao: true,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao carregar o pipeline de percepcao",
  origemFalha: "detector",
  multiframe: true,
};

export const MODO_B: DefinicaoModo = {
  id: "percepcao-sequencia",
  usaDeteccao: false,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao capturar a sequencia de frames",
  origemFalha: "visao",
  multiframe: true,
  variante: VARIANTES_PERCEPCAO.sequencia,
};

export const MODO_C: DefinicaoModo = {
  id: "percepcao-fundida",
  usaDeteccao: true,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao carregar o pipeline de percepcao",
  origemFalha: "detector",
  multiframe: true,
  variante: VARIANTES_PERCEPCAO.fundida,
};

export const CONFIG_CAPTURA = { ...CONFIG_CAPTURA_PADRAO, quadros: 2, intervaloMs: 0 };
export const DEPS_CAPTURA = {
  agora: () => 0,
  esperar: async () => undefined,
  agoraIso: () => "2026-10-17T12:00:00.000Z",
};

export function processamento(): ProcessamentoFrame {
  return {
    deteccoes: {
      deteccoes: [
        { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 1, ymin: 2, xmax: 30, ymax: 40 } },
      ],
      dimensoes: { largura: 640, altura: 480 },
    },
    pose: { pessoas: [] },
    maos: { maos: [] },
    metricas: {},
  };
}
