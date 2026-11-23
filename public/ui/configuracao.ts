import { AdaptadorDetectorObjetos } from "../perception/adapters/object-detector.adapter";
import { AdaptadorNsfwConjunto } from "../perception/adapters/nsfw-classifier.adapter";
import { CONFIG_CAPTURA_PADRAO } from "../capture/webcam-capture";
import type { ConfigCaptura } from "../capture/webcam-capture";
import {
  POLITICA_CICLO_BENCHMARK_5FPS,
  POLITICA_CICLO_BENCHMARK_ADAPTATIVA,
  POLITICA_CICLO_BENCHMARK_ALVO,
  POLITICA_CICLO_OPERACIONAL,
} from "../cycle/politica-ciclo";
import type { PoliticaCiclo } from "../cycle/politica-ciclo";
import { lerPerfilInicializacao, type PerfilInicializacao } from "./perfil-inicializacao";
/**
 * Politica do ciclo (Fase 4): fonte unica de espacamento/quantidade de
 * snapshots, pausa pos-ciclo e frequencia da interpretacao. O intervalo entre
 * inicios continua vindo do seletor da interface (`intervaloMsConfigurado`); a
 * pausa pos-ciclo e contada do **fim** de cada ciclo.
 *
 * `?benchmark=5fps` ativa a politica de cadencia independente (Fase 1.3/1.4):
 * maos a 5 FPS alvo, pose/deteccao a 1 Hz, 5 snapshots a 200 ms.
 * `?benchmark=adaptativa` usa a mesma janela, mas sobe maos/pose apos a entrada
 * confirmada de uma pessoa e volta ao ritmo base com histerese (Fase 4).
 */
const parametrosUrl = new URLSearchParams(window.location.search);
const benchmark = parametrosUrl.get("benchmark");
/** Opt-in `?perfil=leve`: nao carrega pose/maos na partida (Fase 8). */
export const perfilInicializacao: PerfilInicializacao = lerPerfilInicializacao(parametrosUrl);
export const politicaCiclo: PoliticaCiclo =
  benchmark === "5fps"
    ? POLITICA_CICLO_BENCHMARK_5FPS
    : benchmark === "adaptativa"
      ? POLITICA_CICLO_BENCHMARK_ADAPTATIVA
      : benchmark === "eval"
        ? POLITICA_CICLO_BENCHMARK_ALVO
        : POLITICA_CICLO_OPERACIONAL;

/** Captura derivada da politica: quantidade e espacamento dos snapshots. */
export const configuracaoCaptura: ConfigCaptura = {
  ...CONFIG_CAPTURA_PADRAO,
  quadros: politicaCiclo.quantidadeSnapshots,
  intervaloMs: politicaCiclo.intervaloEntreSnapshotsMs,
};

export const detectorCoco = new AdaptadorDetectorObjetos();
/**
 * Classificador NSFW do modo de frame unico (conjunto multi-modelo, um worker
 * dedicado por modelo). O multiframe cria o proprio conjunto dentro do pipeline
 * local; este atende `deteccao`, `eventos`, `visao` e `roteiro` quando o toggle
 * esta ligado.
 */
export const classificadorNsfw = new AdaptadorNsfwConjunto();