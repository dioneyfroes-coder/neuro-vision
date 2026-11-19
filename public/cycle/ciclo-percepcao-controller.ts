/**
 * Controlador do ciclo multiframe (Etapa 5 + 6 + 8 ligadas a interface).
 *
 * Executa o pipeline completo — captura identificada, percepcao local (detector +
 * pose + maos), leitura temporal e interpretacao multimodal — e traduz o
 * `ResultadoCiclo` em `EventoUi`, do mesmo jeito que o `CycleController` de frame
 * unico. Toda a composicao concreta (detector, pose, maos, motor temporal,
 * interpretador) entra por injecao, para que a interface apenas escolha o modo.
 *
 * A variante do modo (`variantes.ts`, Etapa 9) decide o que roda: sem percepcao
 * local (B) o ciclo usa um processador inativo e nao carrega modelos; sem leitura
 * temporal (`ausente`) o `motorTemporal` e omitido do ciclo.
 *
 * Regras preservadas:
 * - a falha de um subsistema nao derruba o ciclo (o pipeline devolve
 *   `indisponivel`); a falha de carga so impede a sessao quando **nenhum**
 *   subsistema carrega;
 * - o diagnostico do ciclo e persistido em best-effort (Etapa 8);
 * - a interpretacao nunca recaptura a camera: usa os snapshots ja guardados.
 */

export type {
  DependenciasCicloPercepcao,
  FilaGravacao,
  PercepcaoMultiframe,
  RepositorioPercepcao,
} from "./ciclo-percepcao-controller/tipos";
export { CicloPercepcaoController } from "./ciclo-percepcao-controller/resultado";
