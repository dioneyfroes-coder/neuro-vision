import type { AmostragemFrame } from "../../../src/domain/cadencia";
import type { TabelaPrecosMultimodal, TelemetriaSubsistema } from "../../../src/domain";
import type {
  CargaModelosCiclo,
  ConfiguracaoCiclo,
  MotivoSupressaoInterpretacao,
  PoliticaCicloAplicada,
  RegistroCiclo,
  ResumoTemporal,
} from "../../../src/domain/cycle";
import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../../src/domain/perception";
import type { SnapshotCapturado, SnapshotStore } from "../../capture/snapshot-store";
import type { WebcamCapture } from "../../capture/webcam-capture";
import type { InterpretadorMultimodal } from "../../interpretation/contracts";
import type { SubsistemaPercepcao } from "../../perception/local-perception-pipeline";
import type { MotorTemporal } from "../../temporal/contracts";

/**
 * `CicloMultiframe` (Etapa 4 do roteiro).
 *
 * Ordem do ciclo: **capturar** os snapshots identificados (sem inferencia),
 * guarda-los no buffer, **depois** processa-los localmente (com concorrencia
 * limitada entre frames — ver `concorrenciaFrames`) e, por fim, enviar
 * `PacoteCiclo` a interpretacao multimodal. As imagens que chegam ao
 * interpretador sao exatamente as guardadas na captura — o pacote carrega os
 * mesmos `imagem`, `frameId` e `capturadoEm`, e a interface do interpretador
 * nao expoe nenhuma camera.
 */

/** Resultado do processamento local de um snapshot (um frame). */
export interface ProcessamentoFrame {
  deteccoes: ResultadoOuIndisponivel<ResultadoDeteccaoLocal>;
  pose: ResultadoOuIndisponivel<ResultadoPose>;
  maos: ResultadoOuIndisponivel<ResultadoMaos>;
  /**
   * Marcacoes NSFW (experimental). Ausente quando o subsistema nao roda
   * (toggle desligado) — distinto de `indisponivel` (tentou e falhou).
   */
  nsfw?: ResultadoOuIndisponivel<ResultadoNsfw>;
  metricas: {
    duracaoDeteccaoMs?: number;
    duracaoPoseMs?: number;
    duracaoMaosMs?: number;
    duracaoNsfwMs?: number;
    /**
     * Telemetria por subsistema no frame (Fase 2, item 5): estado, modelo,
     * dispositivo e versao efetivamente usados. Ausente quando o processador nao
     * a fornece (ex.: variante sem percepcao local).
     */
    subsistemas?: Partial<Record<SubsistemaPercepcao, TelemetriaSubsistema>>;
  };
}

export type { TelemetriaSubsistema };

export interface DependenciasCicloMultiframe {
  /** Captura identificada, sem inferencia. */
  captura: WebcamCapture;
  /** Buffer de snapshots (retencao limitada, limpeza ao falhar/parar). */
  store: SnapshotStore;
  /**
   * Processa um snapshot localmente. Deve representar falha de um subsistema
   * como `indisponivel`, e nao lancando — assim um modelo que falha nao apaga
   * o resultado dos demais.
   */
  processarFrame: (
    snapshot: SnapshotCapturado,
    sinal?: AbortSignal,
    amostragem?: AmostragemFrame
  ) => Promise<ProcessamentoFrame>;
  /**
   * Quantos frames do ciclo sao processados em paralelo (padrao:
   * `CONCORRENCIA_FRAMES_PADRAO`). Cada frame ja roda seus subsistemas em
   * paralelo; este limite controla quantos frames avancam juntos. `1` reproduz
   * o comportamento estritamente sequencial.
   */
  concorrenciaFrames?: number;
  /** Interpretador multimodal; recebe o pacote, nunca a camera. */
  interpretador: InterpretadorMultimodal;
  /**
   * Motor temporal opcional (Etapa 6): consome as observacoes do ciclo e devolve
   * o `ResumoTemporal` que alimenta o pacote e a interpretacao. Mantem estado
   * entre ciclos; ausente, o resumo temporal fica vazio (compatibilidade).
   */
  motorTemporal?: MotorTemporal;
  /** Sessao atual (ids de ciclo derivam dela). */
  sessaoId: string;
  /** Sequencia do proximo ciclo na sessao (1, 2, 3, ...). */
  proximoCycleId: () => string;
  /** Relogio monotonico (ms). Padrao: `performance.now`. */
  agora?: () => number;
  /** Relogio de parede ISO. Padrao: `new Date().toISOString`. */
  agoraIso?: () => string;
  /**
   * Decide se a etapa multimodal roda neste ciclo (Fase 4, item 5). Devolve
   * `interpretar: false` para suprimir a chamada; nesse caso o motivo entra nas
   * metricas (`interpretacaoSuprimida`) e o ciclo segue valido, apenas sem
   * interpretacao. Ausente, a interpretacao roda sempre.
   */
  decidirInterpretacao?: (
    resumoTemporal: ResumoTemporal
  ) => {
    interpretar: boolean;
    motivo?: MotivoSupressaoInterpretacao;
    /** Eventos que justificaram a chamada — usados na telemetria por evento. */
    eventosRelevantes?: readonly string[];
  };
  /** Politica efetiva a registrar no ciclo (Fase 4/P1.4). */
  obterPolitica?: () => PoliticaCicloAplicada;
  /** Variante e parametros efetivos do pipeline para reprodutibilidade (P3.2). */
  obterConfiguracaoCiclo?: () => ConfiguracaoCiclo;
  /**
   * Persiste o diagnostico do ciclo (Etapa 8), opcional. A falha de gravacao
   * **nao** derruba o ciclo nem se confunde com falha de inferencia: entra em
   * `erros` como etapa `persistencia` e o resultado segue valido.
   */
  persistirCiclo?: (registro: RegistroCiclo) => Promise<void> | void;
  /**
   * Carga fria dos modelos da sessao (P3.1), opcional. Devolve o custo de
   * inicializacao ja medido pelo controlador; nao e medido de novo por ciclo.
   */
  obterCargaModelos?: () => CargaModelosCiclo | undefined;
  /**
   * Latencia desde o fim do ciclo anterior ate agora (ms), opcional. O
   * controlador calcula porque mantem o estado entre ciclos; ausente no
   * primeiro ciclo da sessao.
   */
  obterLatenciaEntreCiclosMs?: () => number | undefined;
  /**
   * Registra o instante monotonico de fim do ciclo (sucesso, sem frame ou
   * falha). O controlador usa esse valor como base da latencia entre ciclos e
   * limpa o estado ao reiniciar a sessao.
   */
  registrarFimCiclo?: (fimMs: number) => void;
  /**
   * Tabela de precos explicita para estimativa de custo (Fase 6, item 7).
   * Ausente, o registro de custo fica sem valor monetario e com o motivo —
   * nunca eh inventado preco ou custo zero.
   */
  obterPrecosMultimodal?: () => TabelaPrecosMultimodal | undefined;
}
