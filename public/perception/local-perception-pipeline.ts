/**
 * Pipeline local do ciclo multiframe (Etapa 5 do roteiro).
 *
 * Executa os tres subsistemas — deteccao de objetos, pose e maos/gestos — sobre
 * **cada snapshot** capturado. Os subsistemas de um mesmo frame rodam em
 * **paralelo** (`Promise.all`): sao runtimes distintos (YOLO/Transformers,
 * MediaPipe) e nao competem pela mesma sessao, entao a espera deixa de somar.
 * A previsibilidade continua garantida pelo isolamento por subsistema (abaixo) e
 * pela ordem estavel das observacoes no ciclo — nao pela ordem de conclusao.
 *
 * Cada subsistema e isolado: se um modelo lanca, o pipeline registra
 * `ResultadoIndisponivel` para aquele subsistema e **preserva** o resultado dos
 * demais (principio 8). Assim uma falha de pose nao apaga a deteccao de objetos
 * ja obtida no mesmo frame.
 *
 * O pipeline nao conhece SDK algum: recebe as portas `DetectorObjetos`,
 * `EstimadorPose` e `ReconhecedorGestos`, o snapshot identificado (`frameId`,
 * `capturadoEm`) e devolve `ProcessamentoFrame`, que o `executarCicloMultiframe`
 * associa ao timestamp do snapshot.
 */

export type {
  SubsistemaPercepcao,
  DependenciasPipelineLocal,
  ProcessarFrameLocal,
  ModelosPercepcao,
  HabilitacaoSubsistemas,
  ConfiguracaoParcial,
} from "./local-perception-pipeline/tipos";
export { HABILITACAO_PADRAO } from "./local-perception-pipeline/tipos";
export { PipelineLocal } from "./local-perception-pipeline/pipeline";
export { criarProcessadorFrameLocal, criarProcessadorInativo } from "./local-perception-pipeline/fabricas";
export { configurarSubsistemas } from "./local-perception-pipeline/configuracao";
